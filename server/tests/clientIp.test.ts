import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { reloadConfig } from "../src/config.js";
import { clientIp, edgeIp } from "../src/lib/rateLimit.js";

// Production path for REST: browser -> Vercel rewrite -> Render (Cloudflare edge, then load
// balancer) -> Express. Cloudflare overwrites CF-Connecting-IP with whoever connected to it
// and appends that address to X-Forwarded-For. These tests play both sides of that.

const VERCEL_EGRESS = "76.76.21.21";
const CF_EDGE = "172.70.1.1";

let counter = 0;
const login = () => ({ email: `nobody-${++counter}@example.com`, password: "wrong-password" });

function withClientIpHeader(value: string | undefined) {
  if (value === undefined) delete process.env.CLIENT_IP_HEADER;
  else process.env.CLIENT_IP_HEADER = value;
  reloadConfig();
}

function appWithWhoami(rateLimits = {}) {
  return createApp({
    rateLimits,
    extraRoutes: (app) => {
      app.get("/whoami", (req, res) => {
        res.json({ edge: edgeIp(req), client: clientIp(req) });
      });
    },
  });
}

describe("client address behind the Vercel -> Render proxy chain", () => {
  beforeAll(() => withClientIpHeader("CF-Connecting-IP"));
  afterAll(() => withClientIpHeader(undefined));

  it("keys a proxied request on the real client that Vercel put in X-Forwarded-For", async () => {
    const app = appWithWhoami();
    const res = await request(app)
      .get("/whoami")
      .set("CF-Connecting-IP", VERCEL_EGRESS)
      .set("X-Forwarded-For", `198.51.100.7, ${VERCEL_EGRESS}, ${CF_EDGE}`);
    expect(res.body).toEqual({ edge: VERCEL_EGRESS, client: "198.51.100.7" });
  });

  it("uses the edge address as-is for a direct request, whatever X-Forwarded-For claims", async () => {
    const app = appWithWhoami();
    const direct = await request(app).get("/whoami").set("CF-Connecting-IP", "203.0.113.9");
    expect(direct.body).toEqual({ edge: "203.0.113.9", client: "203.0.113.9" });

    // Spoof attempt that doesn't mention the real address: the claim is ignored.
    const spoofed = await request(app)
      .get("/whoami")
      .set("CF-Connecting-IP", "203.0.113.9")
      .set("X-Forwarded-For", "10.0.0.1");
    expect(spoofed.body).toEqual({ edge: "203.0.113.9", client: "203.0.113.9" });

    // The edge address itself never depends on X-Forwarded-For.
    const forged = await request(app)
      .get("/whoami")
      .set("CF-Connecting-IP", "203.0.113.9")
      .set("X-Forwarded-For", `10.0.0.1, 203.0.113.9, ${CF_EDGE}`);
    expect(forged.body.edge).toBe("203.0.113.9");
  });

  it("ignores a header value that isn't an IP address", async () => {
    const res = await request(appWithWhoami()).get("/whoami").set("CF-Connecting-IP", "not-an-ip");
    expect(res.body.edge).toMatch(/^127\.0\.0\.1$|^::1$/);
  });

  it("doesn't throttle one proxied user for another's sign-in attempts", async () => {
    const app = appWithWhoami({ loginPerIp: { windowMs: 60_000, max: 2 } });
    const as = (client: string) =>
      request(app)
        .post("/auth/login")
        .set("CF-Connecting-IP", VERCEL_EGRESS)
        .set("X-Forwarded-For", `${client}, ${VERCEL_EGRESS}, ${CF_EDGE}`)
        .send(login());

    expect((await as("198.51.100.1")).status).toBe(401);
    expect((await as("198.51.100.1")).status).toBe(401);
    const blocked = await as("198.51.100.1");
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("RATE_LIMITED");
    // A different user behind the same Vercel address is unaffected.
    expect((await as("198.51.100.2")).status).toBe(401);
  });

  it("can't dodge the limits by rotating a fake X-Forwarded-For on direct requests", async () => {
    const app = appWithWhoami({
      loginPerIp: { windowMs: 60_000, max: 100 },
      loginPerEdge: { windowMs: 60_000, max: 3 },
    });
    const attempt = (fake: string) =>
      request(app)
        .post("/auth/login")
        .set("CF-Connecting-IP", "203.0.113.50")
        .set("X-Forwarded-For", `${fake}, 203.0.113.50, ${CF_EDGE}`)
        .send(login());

    for (const fake of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) expect((await attempt(fake)).status).toBe(401);
    expect((await attempt("4.4.4.4")).status).toBe(429);
    // Another real address has its own budget.
    const other = await request(app)
      .post("/auth/login")
      .set("CF-Connecting-IP", "203.0.113.51")
      .send(login());
    expect(other.status).toBe(401);
  });
});

describe("without CLIENT_IP_HEADER", () => {
  it("never trusts CF-Connecting-IP, so a caller can't pick the address with it", async () => {
    withClientIpHeader(undefined);
    const res = await request(appWithWhoami()).get("/whoami").set("CF-Connecting-IP", "203.0.113.9");
    expect(res.body.edge).not.toBe("203.0.113.9");
    expect(res.body.client).toBe(res.body.edge);
  });
});
