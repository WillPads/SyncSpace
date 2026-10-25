import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/lib/rateLimit.js";

describe("RateLimiter", () => {
  it("allows up to max hits per window, then reports how long to wait", () => {
    const limiter = new RateLimiter({ windowMs: 10_000, max: 2 });
    expect(limiter.hit("k", 0)).toBe(0);
    expect(limiter.hit("k", 1_000)).toBe(0);
    expect(limiter.hit("k", 2_000)).toBe(8);
    expect(limiter.retryAfterSeconds("k", 2_000)).toBe(8);
  });

  it("starts a fresh window once the old one ends", () => {
    const limiter = new RateLimiter({ windowMs: 10_000, max: 1 });
    limiter.hit("k", 0);
    expect(limiter.hit("k", 5_000)).toBeGreaterThan(0);
    expect(limiter.hit("k", 10_000)).toBe(0);
  });

  it("keeps keys independent and can reset one", () => {
    const limiter = new RateLimiter({ windowMs: 10_000, max: 1 });
    limiter.hit("a", 0);
    expect(limiter.hit("b", 0)).toBe(0);
    expect(limiter.retryAfterSeconds("a", 0)).toBeGreaterThan(0);
    limiter.reset("a");
    expect(limiter.retryAfterSeconds("a", 0)).toBe(0);
  });

  it("doesn't count a hit when only checking", () => {
    const limiter = new RateLimiter({ windowMs: 10_000, max: 1 });
    expect(limiter.retryAfterSeconds("k", 0)).toBe(0);
    expect(limiter.hit("k", 0)).toBe(0);
  });
});
