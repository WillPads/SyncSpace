import { Prisma } from "@prisma/client";
import { type Request, Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import {
  WS_TICKET_TTL_MS,
  burnPasswordCheck,
  clearSessionCookie,
  createSession,
  hashPassword,
  issueWsTicket,
  revokeAllSessions,
  revokeSessionByToken,
  setSessionCookie,
  verifyPassword,
} from "../lib/auth.js";
import { HttpError, fieldError, parseInput } from "../lib/http.js";
import { type RateLimiters, clientIp, limitBy, tooManyRequests } from "../lib/rateLimit.js";
import { requireAuth, sessionTokenFrom } from "../middleware/requireAuth.js";
import { disconnectSession, disconnectUserEverywhere } from "../ws/registry.js";

// bcrypt only looks at the first 72 bytes, so longer passwords would be silently truncated.
const MAX_PASSWORD_BYTES = 72;

const email = z
  .string(fieldError("Email", "text"))
  .trim()
  .toLowerCase()
  .max(254, "That email address is too long.")
  .email("Enter a valid email address.");

const registerSchema = z.object({
  email,
  password: z
    .string(fieldError("Password", "text"))
    .min(8, "Password must be at least 8 characters.")
    .refine((value) => Buffer.byteLength(value, "utf8") <= MAX_PASSWORD_BYTES, {
      message: `Password must be at most ${MAX_PASSWORD_BYTES} bytes.`,
    }),
  displayName: z
    .string(fieldError("Display name", "text"))
    .trim()
    .min(1, "Display name is required.")
    .max(40, "Display name must be at most 40 characters."),
});

const loginSchema = z.object({
  email,
  password: z.string(fieldError("Password", "text")).min(1, "Password is required.").max(1024),
});

function publicUser(user: { id: string; email: string; displayName: string }) {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

function sessionMeta(req: Request) {
  return { userAgent: req.get("user-agent"), ip: clientIp(req) };
}

export function createAuthRouter(limits: RateLimiters): Router {
  const router = Router();

  router.post(
    "/register",
    limitBy(limits.registerPerIp, (req) => clientIp(req), "Too many sign-ups from this network. Try again later."),
    async (req, res) => {
      const { email, password, displayName } = parseInput(registerSchema, req.body);

      const passwordHash = await hashPassword(password);
      let user;
      try {
        user = await prisma.user.create({ data: { email, passwordHash, displayName } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new HttpError(409, "EMAIL_TAKEN", "An account with that email already exists.");
        }
        throw err;
      }

      const { token } = await createSession(user.id, sessionMeta(req));
      setSessionCookie(res, token);
      res.status(201).json({ user: publicUser(user) });
    }
  );

  router.post(
    "/login",
    limitBy(limits.loginPerIp, (req) => clientIp(req), "Too many sign-in attempts from this network. Try again later."),
    async (req, res) => {
      const { email, password } = parseInput(loginSchema, req.body);

      const accountKey = `login:${email}`;
      const lockedFor = limits.loginFailuresPerAccount.retryAfterSeconds(accountKey);
      if (lockedFor > 0) {
        throw tooManyRequests(res, lockedFor, "Too many failed sign-ins for this account. Try again later.");
      }

      const user = await prisma.user.findUnique({ where: { email } });
      let passwordOk = false;
      if (user) passwordOk = await verifyPassword(password, user.passwordHash);
      else await burnPasswordCheck(password); // same cost as a real check, so timing doesn't reveal accounts
      if (!user || !passwordOk) {
        limits.loginFailuresPerAccount.hit(accountKey);
        throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
      }
      limits.loginFailuresPerAccount.reset(accountKey);

      // A fresh session on every sign-in (no session fixation); the old one, if any, is retired.
      const previous = sessionTokenFrom(req);
      if (previous) {
        const revokedId = await revokeSessionByToken(previous);
        if (revokedId) disconnectSession(revokedId);
      }
      const { token } = await createSession(user.id, sessionMeta(req));
      setSessionCookie(res, token);
      res.json({ user: publicUser(user) });
    }
  );

  // Works without a valid session, so a stale cookie can always be cleared.
  router.post("/logout", async (req, res) => {
    const token = sessionTokenFrom(req);
    if (token) {
      const revokedId = await revokeSessionByToken(token);
      if (revokedId) disconnectSession(revokedId);
    }
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.post("/logout-all", requireAuth, async (req, res) => {
    await revokeAllSessions(req.user!.id);
    disconnectUserEverywhere(req.user!.id);
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.get("/me", requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  // The browser's room socket goes straight to this server in production, where the
  // session cookie (scoped to the frontend's domain) isn't sent. It trades the cookie for a
  // single-use ticket here, over the proxied REST API, and passes that in the socket URL.
  router.get(
    "/ws-ticket",
    requireAuth,
    limitBy(limits.wsTicketPerUser, (req) => req.user?.id ?? null, "Too many connection attempts. Wait a moment."),
    async (req, res) => {
      const { ticket, expiresAt } = await issueWsTicket(req.authSession!.id);
      res.json({ ticket, expiresAt: expiresAt.toISOString(), expiresInSec: WS_TICKET_TTL_MS / 1000 });
    }
  );

  return router;
}
