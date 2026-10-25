import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import {
  SESSION_COOKIE_NAME,
  createSession,
  hashToken,
  issueWsTicket,
  redeemWsTicket,
  validateSession,
} from "../src/lib/auth.js";

const password = "correct-horse-battery-staple";

function sessionCookie(res: request.Response): string {
  const header = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const cookie = header.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!cookie) throw new Error("no session cookie was set");
  return cookie;
}

function tokenOf(cookie: string): string {
  return decodeURIComponent(cookie.split(";")[0].slice(SESSION_COOKIE_NAME.length + 1));
}

describe("server-side sessions", () => {
  const suffix = randomUUID();
  const emails: string[] = [];
  const newEmail = (label: string) => {
    const email = `session-${label}-${suffix}@example.com`;
    emails.push(email);
    return email;
  };
  const app = createApp();

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  it("stores only a hash of the session token, in an HttpOnly SameSite=Lax cookie", async () => {
    const email = newEmail("hash");
    const res = await request(app).post("/auth/register").send({ email, password, displayName: "Hash" });
    expect(res.status).toBe(201);

    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);

    const token = tokenOf(cookie);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await prisma.session.findMany({ where: { user: { email } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(hashToken(token));
    expect(rows[0].id).not.toBe(token);
  });

  it("deletes the session on logout, so a copied cookie stops working", async () => {
    const email = newEmail("logout");
    const reg = await request(app).post("/auth/register").send({ email, password, displayName: "Logout" });
    const cookie = sessionCookie(reg).split(";")[0];

    expect((await request(app).get("/auth/me").set("Cookie", cookie)).status).toBe(200);
    const logout = await request(app).post("/auth/logout").set("Cookie", cookie);
    expect(logout.status).toBe(204);
    expect(sessionCookie(logout)).toMatch(/Expires=Thu, 01 Jan 1970/);

    expect(await prisma.session.count({ where: { user: { email } } })).toBe(0);
    expect((await request(app).get("/auth/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("accepts logout without a session", async () => {
    expect((await request(app).post("/auth/logout")).status).toBe(204);
  });

  it("issues a fresh session on login and retires the one the browser had", async () => {
    const email = newEmail("rotate");
    const agent = request.agent(app);
    const reg = await agent.post("/auth/register").send({ email, password, displayName: "Rotate" });
    const before = tokenOf(sessionCookie(reg));

    const login = await agent.post("/auth/login").send({ email, password });
    expect(login.status).toBe(200);
    const after = tokenOf(sessionCookie(login));
    expect(after).not.toBe(before);

    expect(await prisma.session.findUnique({ where: { id: hashToken(before) } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: hashToken(after) } })).not.toBeNull();
  });

  it("signs out every device with /auth/logout-all", async () => {
    const email = newEmail("all");
    const laptop = request.agent(app);
    const phone = request.agent(app);
    await laptop.post("/auth/register").send({ email, password, displayName: "All" });
    await phone.post("/auth/login").send({ email, password });
    expect(await prisma.session.count({ where: { user: { email } } })).toBe(2);

    expect((await laptop.post("/auth/logout-all")).status).toBe(204);
    expect((await phone.get("/auth/me")).status).toBe(401);
    expect(await prisma.session.count({ where: { user: { email } } })).toBe(0);
  });

  it("rejects and deletes an expired session, and clears its cookie", async () => {
    const email = newEmail("expired");
    const reg = await request(app).post("/auth/register").send({ email, password, displayName: "Expired" });
    const cookie = sessionCookie(reg).split(";")[0];
    await prisma.session.updateMany({ where: { user: { email } }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(res.status).toBe(401);
    expect(sessionCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(await prisma.session.count({ where: { user: { email } } })).toBe(0);
  });

  it("extends a session that's still in use (sliding expiry) and re-sends the cookie", async () => {
    const email = newEmail("sliding");
    const reg = await request(app).post("/auth/register").send({ email, password, displayName: "Sliding" });
    const cookie = sessionCookie(reg).split(";")[0];
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.session.updateMany({ where: { user: { email } }, data: { lastUsedAt: twoDaysAgo, expiresAt: soon } });

    const res = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(sessionCookie(res)).toMatch(/Max-Age=604800/);
    const row = await prisma.session.findFirstOrThrow({ where: { user: { email } } });
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
  });

  it("validates input with readable messages", async () => {
    const tooLong = "å".repeat(37); // 74 bytes in UTF-8: bcrypt would silently ignore the tail
    const res = await request(app)
      .post("/auth/register")
      .send({ email: newEmail("long"), password: tooLong, displayName: "Long" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Password must be at most 72 bytes.", code: "VALIDATION_ERROR" });

    const bad = await request(app).post("/auth/register").send({ email: "not-an-email", password, displayName: "X" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("Enter a valid email address.");
  });

  it("answers two simultaneous sign-ups for one email with 201 and 409, without crashing", async () => {
    const email = newEmail("race");
    const [a, b] = await Promise.all([
      request(app).post("/auth/register").send({ email, password, displayName: "A" }),
      request(app).post("/auth/register").send({ email, password, displayName: "B" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((a.status === 409 ? a : b).body.code).toBe("EMAIL_TAKEN");
    expect((await request(app).get("/health")).status).toBe(200);
  });

  it("locks an account after repeated failed logins without affecting other accounts", async () => {
    const strict = createApp({ rateLimits: { loginFailuresPerAccount: { windowMs: 60_000, max: 2 } } });
    const email = newEmail("locked");
    const other = newEmail("other");
    await request(strict).post("/auth/register").send({ email, password, displayName: "Locked" });
    await request(strict).post("/auth/register").send({ email: other, password, displayName: "Other" });

    expect((await request(strict).post("/auth/login").send({ email, password: "wrong-1" })).status).toBe(401);
    expect((await request(strict).post("/auth/login").send({ email, password: "wrong-2" })).status).toBe(401);
    const locked = await request(strict).post("/auth/login").send({ email, password });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("RATE_LIMITED");
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);

    expect((await request(strict).post("/auth/login").send({ email: other, password })).status).toBe(200);
  });
});

describe("WebSocket tickets", () => {
  const suffix = randomUUID();
  const email = `ticket-${suffix}@example.com`;
  let sessionId = "";

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
  });

  it("can be redeemed exactly once", async () => {
    const user = await prisma.user.create({ data: { email, passwordHash: "x", displayName: "Ticket" } });
    const { session } = await createSession(user.id);
    sessionId = session.id;
    const { ticket } = await issueWsTicket(sessionId);

    const [first, second] = await Promise.all([redeemWsTicket(ticket), redeemWsTicket(ticket)]);
    const winners = [first, second].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]).toEqual({ userId: user.id, sessionId });
    expect(await redeemWsTicket(ticket)).toBeNull();
  });

  it("expires, and dies with its session", async () => {
    const issuedAt = new Date();
    const { ticket: stale } = await issueWsTicket(sessionId, issuedAt);
    expect(await redeemWsTicket(stale, new Date(issuedAt.getTime() + 31_000))).toBeNull();

    const { ticket } = await issueWsTicket(sessionId);
    await prisma.session.delete({ where: { id: sessionId } });
    expect(await redeemWsTicket(ticket)).toBeNull();
  });

  it("isn't accepted as a session cookie", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const { session } = await createSession(user.id);
    const { ticket } = await issueWsTicket(session.id);
    expect(await validateSession(ticket)).toBeNull();
  });
});
