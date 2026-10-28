import { Prisma } from "@prisma/client";
import { type Request, type Response, Router } from "express";
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
import { deleteAccount } from "../lib/accountDeletion.js";
import { HttpError, fieldError, parseInput } from "../lib/http.js";
import { type RateLimiters, clientIp, edgeIp, limitBy, tooManyRequests } from "../lib/rateLimit.js";
import { requireAuth, sessionTokenFrom } from "../middleware/requireAuth.js";
import { disconnectSession, disconnectUserEverywhere, disconnectUserExceptSession, hasClients } from "../ws/registry.js";
import { publishRoomInBackground } from "../ws/roomFeed.js";

// bcrypt only looks at the first 72 bytes, so longer passwords would be silently truncated.
const MAX_PASSWORD_BYTES = 72;

const email = z
  .string(fieldError("Email", "text"))
  .trim()
  .toLowerCase()
  .max(254, "That email address is too long.")
  .email("Enter a valid email address.");

const newPassword = (label: string) =>
  z
    .string(fieldError(label, "text"))
    .min(8, "Password must be at least 8 characters.")
    .refine((value) => Buffer.byteLength(value, "utf8") <= MAX_PASSWORD_BYTES, {
      message: `Password must be at most ${MAX_PASSWORD_BYTES} bytes.`,
    });

const displayName = z
  .string(fieldError("Display name", "text"))
  .trim()
  .min(1, "Display name is required.")
  .max(40, "Display name must be at most 40 characters.");

/** The password someone types to prove it's really them; never length-checked beyond a sane cap. */
const enteredPassword = (label: string) =>
  z.string(fieldError(label, "text")).min(1, `${label} is required.`).max(1024, `${label} is too long.`);

const registerSchema = z.object({ email, password: newPassword("Password"), displayName });

const updateProfileSchema = z.object({
  displayName: displayName.optional(),
  email: email.optional(),
  currentPassword: enteredPassword("Current password").optional(),
});

const changePasswordSchema = z
  .object({ currentPassword: enteredPassword("Current password"), newPassword: newPassword("New password") })
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: "Choose a new password that is different from your current one.",
    path: ["newPassword"],
  });

const deleteAccountSchema = z.object({ password: enteredPassword("Password") });

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

  /**
   * Re-checks the signed-in user's password before a sensitive change. A wrong password is 403
   * (never 401: the client treats 401 as "your session ended" and signs the user out). Wrong
   * guesses count against the same per-account limiter as sign-in, so a stolen session can't be
   * used to guess the password faster than the login page allows.
   */
  async function confirmPassword(res: Response, user: { email: string; passwordHash: string }, supplied: string) {
    const accountKey = `login:${user.email}`;
    const lockedFor = limits.loginFailuresPerAccount.retryAfterSeconds(accountKey);
    if (lockedFor > 0) {
      throw tooManyRequests(res, lockedFor, "Too many failed password checks for this account. Try again later.");
    }
    if (!(await verifyPassword(supplied, user.passwordHash))) {
      limits.loginFailuresPerAccount.hit(accountKey);
      throw new HttpError(403, "INVALID_PASSWORD", "That password is incorrect.");
    }
  }

  router.post(
    "/register",
    limitBy(limits.registerPerIp, (req) => clientIp(req), "Too many sign-ups from this network. Try again later."),
    limitBy(limits.registerPerEdge, (req) => edgeIp(req), "Too many sign-ups right now. Try again later."),
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
    limitBy(limits.loginPerEdge, (req) => edgeIp(req), "Too many sign-in attempts right now. Try again later."),
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

  router.patch(
    "/me",
    requireAuth,
    limitBy(limits.profileUpdatePerUser, (req) => req.user?.id ?? null, "You're changing your profile too often. Try again later."),
    async (req, res) => {
      const input = parseInput(updateProfileSchema, req.body);
      if (input.displayName === undefined && input.email === undefined) {
        throw new HttpError(400, "VALIDATION_ERROR", "Provide a display name and/or an email to change.");
      }
      const userId = req.user!.id;
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

      const data: { displayName?: string; email?: string } = {};
      if (input.displayName !== undefined && input.displayName !== user.displayName) data.displayName = input.displayName;
      if (input.email !== undefined && input.email !== user.email) {
        // Changing the sign-in email is an account-takeover step, so it needs the password again.
        if (input.currentPassword === undefined) {
          throw new HttpError(400, "VALIDATION_ERROR", "Enter your current password to change your email.");
        }
        await confirmPassword(res, user, input.currentPassword);
        data.email = input.email;
      }
      if (Object.keys(data).length === 0) {
        res.json({ user: publicUser(user) });
        return;
      }

      let updated;
      try {
        updated = await prisma.user.update({ where: { id: userId }, data });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new HttpError(409, "EMAIL_TAKEN", "An account with that email already exists.");
        }
        throw err;
      }

      if (data.displayName !== undefined) {
        // Rooms show the name on the people list, so push a fresh snapshot to rooms people have open.
        const rooms = await prisma.participant.findMany({ where: { userId }, select: { roomId: true } });
        for (const { roomId } of rooms) if (hasClients(roomId)) publishRoomInBackground(roomId);
      }
      res.json({ user: publicUser(updated) });
    }
  );

  router.post(
    "/change-password",
    requireAuth,
    limitBy(limits.changePasswordPerUser, (req) => req.user?.id ?? null, "Too many password changes. Try again later."),
    async (req, res) => {
      const input = parseInput(changePasswordSchema, req.body);
      const userId = req.user!.id;
      const currentSessionId = req.authSession!.id;
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      await confirmPassword(res, user, input.currentPassword);

      const passwordHash = await hashPassword(input.newPassword);
      // Every other device is signed out (if someone else had the old password, this locks them
      // out); the one making the change stays signed in.
      await prisma.$transaction([
        prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
        prisma.session.deleteMany({ where: { userId, id: { not: currentSessionId } } }),
      ]);
      disconnectUserExceptSession(userId, currentSessionId);
      res.status(204).end();
    }
  );

  router.post(
    "/delete-account",
    requireAuth,
    limitBy(limits.deleteAccountPerUser, (req) => req.user?.id ?? null, "Too many attempts. Try again later."),
    async (req, res) => {
      const { password } = parseInput(deleteAccountSchema, req.body);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
      await confirmPassword(res, user, password);

      await deleteAccount(user.id);
      clearSessionCookie(res);
      res.status(204).end();
    }
  );

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
