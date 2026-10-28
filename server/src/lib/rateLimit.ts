import { isIP } from "node:net";
import type { Request, RequestHandler, Response } from "express";
import { getConfig } from "../config.js";
import { HttpError } from "./http.js";

export interface RateLimitRule {
  windowMs: number;
  max: number;
}

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window counter kept in memory. One instance per rule per app, so it resets on
 * restart and isn't shared across server instances - fine for a single-instance deploy,
 * and it never makes a request depend on the database.
 */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  private operations = 0;

  constructor(readonly rule: RateLimitRule) {}

  /** Seconds until `key` may try again, or 0 if it's under the limit. Doesn't count a hit. */
  retryAfterSeconds(key: string, now = Date.now()): number {
    const window = this.windows.get(key);
    if (!window || window.resetAt <= now || window.count < this.rule.max) return 0;
    return Math.max(1, Math.ceil((window.resetAt - now) / 1000));
  }

  /** Counts a hit for `key`. Returns the seconds to wait if that hit was over the limit, else 0. */
  hit(key: string, now = Date.now()): number {
    if (++this.operations % 500 === 0) this.sweep(now);
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + this.rule.windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    if (window.count <= this.rule.max) return 0;
    return Math.max(1, Math.ceil((window.resetAt - now) / 1000));
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

/** Sets Retry-After on the response and returns the 429 to throw. */
export function tooManyRequests(res: Response, retryAfterSec: number, message: string): HttpError {
  res.setHeader("Retry-After", String(retryAfterSec));
  return new HttpError(429, "RATE_LIMITED", message);
}

/** Express middleware: one hit per request against `keyOf(req)` (skipped when it returns null). */
export function limitBy(limiter: RateLimiter, keyOf: (req: Request) => string | null, message: string): RequestHandler {
  return (req, res, next) => {
    const key = keyOf(req);
    if (key === null) {
      next();
      return;
    }
    const retryAfter = limiter.hit(key);
    if (retryAfter > 0) {
      next(tooManyRequests(res, retryAfter, message));
      return;
    }
    next();
  };
}

// "::ffff:1.2.3.4" (an IPv4 address in IPv6 clothing) and "1.2.3.4" are the same client.
function normalizeIp(value: string): string {
  return value.trim().toLowerCase().replace(/^::ffff:/, "");
}

/**
 * The address that connected to our edge. This one can't be faked: with CLIENT_IP_HEADER set
 * (Cloudflare's CF-Connecting-IP on Render) it is the header the edge overwrites on every
 * request; without it, it is Express's req.ip, which follows TRUST_PROXY. For traffic that
 * came through Vercel's rewrite this is Vercel's address, shared by all of its users, so it is
 * only good for a generous flood limit, never as the "who is this user" key.
 */
export function edgeIp(req: Request): string {
  const header = getConfig().clientIpHeader;
  const value = header ? req.get(header) : undefined;
  if (value && isIP(normalizeIp(value))) return normalizeIp(value);
  return normalizeIp(req.ip ?? req.socket.remoteAddress ?? "unknown");
}

/**
 * Best-effort real client address. When a proxy such as Vercel's sits in front of our edge,
 * it puts the client in X-Forwarded-For and the edge appends the proxy after it, so the entry
 * just left of the edge address is the client. A caller who talks to the edge directly can put
 * anything in that spot, so this is for fairness (so one user isn't throttled for another's
 * traffic), and the edge limit is what bounds an attacker. Falls back to the edge address.
 */
export function clientIp(req: Request): string {
  const edge = edgeIp(req);
  if (!getConfig().clientIpHeader) return edge;
  const chain = (req.get("x-forwarded-for") ?? "").split(",").map(normalizeIp);
  const at = chain.lastIndexOf(edge);
  const claimed = at > 0 ? chain[at - 1] : undefined;
  return claimed && isIP(claimed) ? claimed : edge;
}

export interface RateLimitConfig {
  /** Failed logins per email address. Successful logins reset the count. */
  loginFailuresPerAccount: RateLimitRule;
  /** All login attempts per client IP (a backstop against spraying many accounts). */
  loginPerIp: RateLimitRule;
  registerPerIp: RateLimitRule;
  /**
   * Flood ceilings per edge address (see edgeIp). Behind Vercel this one address stands for
   * every user, so these are much higher than the per-client ones; they exist so that faking
   * X-Forwarded-For can't get around the per-client limits.
   */
  loginPerEdge: RateLimitRule;
  registerPerEdge: RateLimitRule;
  createRoomPerUser: RateLimitRule;
  /** Joining by code - also what stops anyone from guessing room codes. */
  joinPerUser: RateLimitRule;
  uploadPerUser: RateLimitRule;
  wsTicketPerUser: RateLimitRule;
  /** Settings: profile edits, password changes, account deletion (all per signed-in user). */
  profileUpdatePerUser: RateLimitRule;
  changePasswordPerUser: RateLimitRule;
  deleteAccountPerUser: RateLimitRule;
  /** Autosave of the scratch note, so it is chatty by design. */
  quickNotePerUser: RateLimitRule;
  scheduleWritePerUser: RateLimitRule;
  chatPerUser: RateLimitRule;
}

const SECOND = 1000;
const MINUTE = 60_000;

// The per-IP limits are deliberately loose (a classroom can sit behind one NAT); the
// per-account and per-user limits are the ones that actually stop guessing.
export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  loginFailuresPerAccount: { windowMs: 15 * MINUTE, max: 10 },
  loginPerIp: { windowMs: 15 * MINUTE, max: 300 },
  registerPerIp: { windowMs: 60 * MINUTE, max: 100 },
  loginPerEdge: { windowMs: 15 * MINUTE, max: 3000 },
  registerPerEdge: { windowMs: 60 * MINUTE, max: 1000 },
  createRoomPerUser: { windowMs: 60 * MINUTE, max: 30 },
  joinPerUser: { windowMs: 10 * MINUTE, max: 30 },
  uploadPerUser: { windowMs: 60 * MINUTE, max: 20 },
  wsTicketPerUser: { windowMs: MINUTE, max: 30 },
  profileUpdatePerUser: { windowMs: 60 * MINUTE, max: 10 },
  changePasswordPerUser: { windowMs: 15 * MINUTE, max: 5 },
  deleteAccountPerUser: { windowMs: 60 * MINUTE, max: 5 },
  quickNotePerUser: { windowMs: MINUTE, max: 60 },
  scheduleWritePerUser: { windowMs: 60 * MINUTE, max: 30 },
  chatPerUser: { windowMs: 10 * SECOND, max: 10 },
};

export type RateLimiters = { [K in keyof RateLimitConfig]: RateLimiter };

export function createRateLimiters(overrides: Partial<RateLimitConfig> = {}): RateLimiters {
  const config = { ...DEFAULT_RATE_LIMITS, ...overrides };
  return Object.fromEntries(
    Object.entries(config).map(([name, rule]) => [name, new RateLimiter(rule)])
  ) as RateLimiters;
}
