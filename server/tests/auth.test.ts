import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

describe("auth routes", () => {
  const email = `auth-${randomUUID()}@example.com`;
  const password = "correct-horse-battery-staple";
  const app = createApp();

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
  });

  it("rejects registration with a short password", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email, password: "short", displayName: "Ada" });
    expect(res.status).toBe(400);
  });

  it("registers a new user and sets an auth cookie", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email, password, displayName: "Ada" });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email, displayName: "Ada" });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.headers["set-cookie"]?.[0]).toMatch(/syncspace_token=/);
  });

  it("rejects a duplicate registration", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email, password, displayName: "Ada Again" });
    expect(res.status).toBe(409);
  });

  it("rejects login with the wrong password", async () => {
    const res = await request(app).post("/auth/login").send({ email, password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("logs in with the correct password and can then fetch /auth/me", async () => {
    const agent = request.agent(app);
    const loginRes = await agent.post("/auth/login").send({ email, password });
    expect(loginRes.status).toBe(200);

    const meRes = await agent.get("/auth/me");
    expect(meRes.status).toBe(200);
    expect(meRes.body.user).toMatchObject({ email, displayName: "Ada" });
  });

  it("rejects /auth/me without a session", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("clears the cookie on logout", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/login").send({ email, password });
    const logoutRes = await agent.post("/auth/logout");
    expect(logoutRes.status).toBe(204);

    const meRes = await agent.get("/auth/me");
    expect(meRes.status).toBe(401);
  });
});
