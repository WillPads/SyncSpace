import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Session } from "@prisma/client";
import type { CookieOptions, Response } from "express";
import { getConfig } from "../config.js";
import { prisma } from "../db.js";

/**
 * Server-side sessions. The cookie holds a random 256-bit token; the database stores only
 * its SHA-256 hash, so a leaked database can't be replayed as live sessions. Deleting the
 * row signs that device out immediately - on the next request and on its open sockets.
 */
export const SESSION_COOKIE_NAME = "syncspace_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Sliding expiry: a session that's used again after a day gets a fresh 7 days. */
const SESSION_RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
export const WS_TICKET_TTL_MS = 30_000;
const BCRYPT_ROUNDS = 10;
const MAX_TOKEN_LENGTH = 128;

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function clip(value: string | undefined, max: number): string | null {
  return value ? value.slice(0, max) : null;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

let dummyHash: Promise<string> | undefined;

/** Compares against a throwaway hash so unknown emails take as long as wrong passwords. */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= bcrypt.hash("syncspace-timing-equalizer", BCRYPT_ROUNDS);
  await bcrypt.compare(password, await dummyHash);
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string; ip?: string } = {},
  now = new Date()
): Promise<{ token: string; session: Session }> {
  const token = newToken();
  const session = await prisma.session.create({
    data: {
      id: hashToken(token),
      userId,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      lastUsedAt: now,
      userAgent: clip(meta.userAgent, 255),
      ip: clip(meta.ip, 64),
    },
  });
  return { token, session };
}

export interface ValidatedSession {
  session: Session;
  user: AuthenticatedUser;
  /** True when the expiry was just extended, so the cookie should be re-sent. */
  renewed: boolean;
}

export async function validateSession(token: string, now = new Date()): Promise<ValidatedSession | null> {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const id = hashToken(token);
  const found = await prisma.session.findUnique({
    where: { id },
    include: { user: { select: { id: true, email: true, displayName: true } } },
  });
  if (!found) return null;

  const { user, ...session } = found;
  if (session.expiresAt.getTime() <= now.getTime()) {
    await prisma.session.deleteMany({ where: { id } });
    return null;
  }

  if (now.getTime() - session.lastUsedAt.getTime() < SESSION_RENEW_AFTER_MS) {
    return { session, user, renewed: false };
  }

  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  // updateMany, not update: if the session was revoked a moment ago, this is a no-op, not an error.
  const { count } = await prisma.session.updateMany({ where: { id }, data: { lastUsedAt: now, expiresAt } });
  if (count === 0) return null;
  return { session: { ...session, lastUsedAt: now, expiresAt }, user, renewed: true };
}

/** Looks a raw cookie token up and deletes its session. Returns the session id if one existed. */
export async function revokeSessionByToken(token: string): Promise<string | null> {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const id = hashToken(token);
  const { count } = await prisma.session.deleteMany({ where: { id } });
  return count > 0 ? id : null;
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { userId } });
  return count;
}

export async function issueWsTicket(sessionId: string, now = new Date()): Promise<{ ticket: string; expiresAt: Date }> {
  const ticket = newToken();
  const expiresAt = new Date(now.getTime() + WS_TICKET_TTL_MS);
  await prisma.wsTicket.create({ data: { id: hashToken(ticket), sessionId, expiresAt } });
  return { ticket, expiresAt };
}

/**
 * Redeems a WebSocket ticket. Deleting the row is what spends it, and a row can only be
 * deleted once, so two sockets racing with the same ticket can't both get in.
 */
export async function redeemWsTicket(
  ticket: string,
  now = new Date()
): Promise<{ userId: string; sessionId: string } | null> {
  if (ticket.length === 0 || ticket.length > MAX_TOKEN_LENGTH) return null;
  const id = hashToken(ticket);
  const found = await prisma.wsTicket.findUnique({
    where: { id },
    include: { session: { select: { id: true, userId: true, expiresAt: true } } },
  });
  if (!found) return null;

  const { count } = await prisma.wsTicket.deleteMany({ where: { id } });
  if (count === 0) return null;
  if (found.expiresAt.getTime() <= now.getTime()) return null;
  if (found.session.expiresAt.getTime() <= now.getTime()) return null;
  return { userId: found.session.userId, sessionId: found.session.id };
}

/** Housekeeping: drops sessions and tickets that can no longer be used. */
export async function purgeExpiredAuthRecords(now = new Date()): Promise<void> {
  await prisma.wsTicket.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
}

function baseCookieOptions(): CookieOptions {
  return { httpOnly: true, sameSite: "lax", secure: getConfig().isProduction, path: "/" };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, { ...baseCookieOptions(), maxAge: SESSION_TTL_MS });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, baseCookieOptions());
}
