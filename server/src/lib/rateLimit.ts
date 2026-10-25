import type { Request, RequestHandler, Response } from "express";
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

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export interface RateLimitConfig {
  /** Failed logins per email address. Successful logins reset the count. */
  loginFailuresPerAccount: RateLimitRule;
  /** All login attempts per client IP (a backstop against spraying many accounts). */
  loginPerIp: RateLimitRule;
  registerPerIp: RateLimitRule;
  createRoomPerUser: RateLimitRule;
  /** Joining by code - also what stops anyone from guessing room codes. */
  joinPerUser: RateLimitRule;
  uploadPerUser: RateLimitRule;
  wsTicketPerUser: RateLimitRule;
}

const MINUTE = 60_000;

// The per-IP limits are deliberately loose. In production every browser request reaches the
// server through Vercel's proxy and Cloudflare, so several users can share one apparent IP
// (a classroom behind one NAT, or a proxy egress address); the per-account and per-user
// limits are the ones that actually stop guessing.
export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  loginFailuresPerAccount: { windowMs: 15 * MINUTE, max: 10 },
  loginPerIp: { windowMs: 15 * MINUTE, max: 300 },
  registerPerIp: { windowMs: 60 * MINUTE, max: 100 },
  createRoomPerUser: { windowMs: 60 * MINUTE, max: 30 },
  joinPerUser: { windowMs: 10 * MINUTE, max: 30 },
  uploadPerUser: { windowMs: 60 * MINUTE, max: 20 },
  wsTicketPerUser: { windowMs: MINUTE, max: 30 },
};

export type RateLimiters = { [K in keyof RateLimitConfig]: RateLimiter };

export function createRateLimiters(overrides: Partial<RateLimitConfig> = {}): RateLimiters {
  const config = { ...DEFAULT_RATE_LIMITS, ...overrides };
  return Object.fromEntries(
    Object.entries(config).map(([name, rule]) => [name, new RateLimiter(rule)])
  ) as RateLimiters;
}
