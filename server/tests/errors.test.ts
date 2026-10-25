import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { HttpError } from "../src/lib/http.js";

describe("error handling", () => {
  const email = `errors-${randomUUID()}@example.com`;

  const app = createApp({
    extraRoutes: (app) => {
      app.get("/__test/async-throw", async () => {
        await Promise.resolve();
        throw new Error("boom");
      });
      app.get("/__test/http-error", async () => {
        throw new HttpError(418, "TEAPOT", "I'm a teapot.");
      });
      app.get("/__test/duplicate", async (_req, res) => {
        await prisma.user.create({ data: { email, passwordHash: "x", displayName: "Dup" } });
        await prisma.user.create({ data: { email, passwordHash: "x", displayName: "Dup" } });
        res.json({ unreachable: true });
      });
    },
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
  });

  it("turns a rejected async handler into a JSON 500 and keeps serving", async () => {
    const res = await request(app).get("/__test/async-throw");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Something went wrong.", code: "INTERNAL_ERROR" });
    expect((await request(app).get("/health")).status).toBe(200);
  });

  it("passes HttpErrors through with their status and code", async () => {
    const res = await request(app).get("/__test/http-error");
    expect(res.status).toBe(418);
    expect(res.body).toEqual({ error: "I'm a teapot.", code: "TEAPOT" });
  });

  it("maps a unique-constraint violation to 409", async () => {
    const res = await request(app).get("/__test/duplicate");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
  });

  it("answers malformed JSON with a JSON 400", async () => {
    const res = await request(app).post("/auth/login").set("Content-Type", "application/json").send("{not json");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "The request body isn't valid JSON.", code: "INVALID_JSON" });
  });

  it("answers an oversized JSON body with 413", async () => {
    const res = await request(app)
      .post("/auth/login")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ email: "a@b.co", password: "x".repeat(200_000) }));
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("answers unknown routes with a JSON 404", async () => {
    const res = await request(app).get("/no/such/route");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found.", code: "NOT_FOUND" });
  });

  it("marks every response as uncacheable and hides the framework", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("allows credentialed CORS only for the configured origin", async () => {
    const ok = await request(app).get("/health").set("Origin", "http://localhost:3000");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(ok.headers["access-control-allow-credentials"]).toBe("true");

    const other = await request(app).get("/health").set("Origin", "https://evil.example");
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("reports database readiness", async () => {
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", database: "ok" });
  });
});
