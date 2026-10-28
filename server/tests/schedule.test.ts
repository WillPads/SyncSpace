import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { cleanupUsers, registerUser, roomWith } from "./helpers.js";

const suffix = randomUUID();
const emails: string[] = [];
const newEmail = (label: string) => {
  const email = `sched-${label}-${suffix}@example.com`;
  emails.push(email);
  return email;
};

afterAll(() => cleanupUsers(emails));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const inFuture = (ms: number) => new Date(Date.now() + ms).toISOString();

function addSession(roomId: string, startsAt: Date, durationMin = 30, createdById: string | null = null) {
  return prisma.scheduledSession.create({ data: { roomId, startsAt, durationMin, createdById } });
}

describe("room schedule", () => {
  const app = createApp();

  async function setup(label: string) {
    const admin = await registerUser(app, newEmail(`${label}-admin`), "Admin");
    const member = await registerUser(app, newEmail(`${label}-member`), "Member");
    const outsider = await registerUser(app, newEmail(`${label}-outsider`), "Outsider");
    const room = await roomWith(admin, `Schedule ${label}`, [member]);
    return { admin, member, outsider, room };
  }

  it("requires a session on every route", async () => {
    const id = randomUUID();
    expect((await request(app).get(`/rooms/${id}/schedule`)).status).toBe(401);
    expect((await request(app).post(`/rooms/${id}/schedule`).send({})).status).toBe(401);
    expect((await request(app).patch(`/rooms/${id}/schedule/${id}`).send({})).status).toBe(401);
    expect((await request(app).delete(`/rooms/${id}/schedule/${id}`)).status).toBe(401);
    expect((await request(app).get("/schedule/upcoming")).status).toBe(401);
  });

  it("keeps outsiders out and lets members read but not write", async () => {
    const { admin, member, outsider, room } = await setup("rbac");
    const session = (await admin.agent.post(`/rooms/${room.id}/schedule`).send({ startsAt: inFuture(DAY), durationMin: 60 }).expect(201)).body.session;
    const body = { startsAt: inFuture(2 * DAY), durationMin: 45 };

    for (const call of [
      () => outsider.agent.get(`/rooms/${room.id}/schedule`),
      () => outsider.agent.post(`/rooms/${room.id}/schedule`).send(body),
      () => outsider.agent.patch(`/rooms/${room.id}/schedule/${session.id}`).send(body),
      () => outsider.agent.delete(`/rooms/${room.id}/schedule/${session.id}`),
    ]) {
      const res = await call();
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("NOT_A_MEMBER");
    }
    expect((await member.agent.get(`/rooms/${room.id}/schedule`).expect(200)).body.sessions).toHaveLength(1);
    for (const call of [
      () => member.agent.post(`/rooms/${room.id}/schedule`).send(body),
      () => member.agent.patch(`/rooms/${room.id}/schedule/${session.id}`).send(body),
      () => member.agent.delete(`/rooms/${room.id}/schedule/${session.id}`),
    ]) {
      const res = await call();
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    }
    expect(await prisma.scheduledSession.count({ where: { roomId: room.id } })).toBe(1);
  });

  it("validates start time and duration", async () => {
    const { admin, room } = await setup("validate");
    const post = (body: unknown) => admin.agent.post(`/rooms/${room.id}/schedule`).send(body as object);
    const cases: unknown[] = [
      {},
      { durationMin: 60 },
      { startsAt: inFuture(DAY) },
      { startsAt: "tomorrow", durationMin: 60 },
      { startsAt: "2030-01-01", durationMin: 60 },
      { startsAt: 1_900_000_000_000, durationMin: 60 },
      { startsAt: inFuture(-HOUR), durationMin: 60 },
      { startsAt: inFuture(366 * DAY), durationMin: 60 },
      { startsAt: inFuture(DAY), durationMin: 14 },
      { startsAt: inFuture(DAY), durationMin: 241 },
      { startsAt: inFuture(DAY), durationMin: 30.5 },
      { startsAt: inFuture(DAY), durationMin: "60" },
    ];
    for (const body of cases) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    }
    // The boundaries themselves are fine.
    await post({ startsAt: inFuture(DAY), durationMin: 15 }).expect(201);
    await post({ startsAt: inFuture(364 * DAY), durationMin: 240 }).expect(201);
  });

  it("creates, lists upcoming ones soonest first, and hides sessions that are over", async () => {
    const { admin, member, room } = await setup("list");
    const later = (await admin.agent.post(`/rooms/${room.id}/schedule`).send({ startsAt: inFuture(3 * DAY), durationMin: 60 }).expect(201)).body.session;
    expect(later).toEqual({
      id: expect.any(String),
      roomId: room.id,
      startsAt: expect.any(String),
      durationMin: 60,
      createdById: admin.id,
    });
    const sooner = (await admin.agent.post(`/rooms/${room.id}/schedule`).send({ startsAt: inFuture(DAY), durationMin: 30 }).expect(201)).body.session;
    const running = await addSession(room.id, new Date(Date.now() - 10 * 60_000), 60); // started 10 min ago, 60 min long
    await addSession(room.id, new Date(Date.now() - 2 * HOUR), 30); // ended 90 minutes ago

    const res = await member.agent.get(`/rooms/${room.id}/schedule`).expect(200);
    expect(res.body.sessions.map((s: { id: string }) => s.id)).toEqual([running.id, sooner.id, later.id]);
  });

  it("refuses a 21st upcoming session and holds the cap under simultaneous requests", async () => {
    const { admin, room } = await setup("cap");
    const base = Date.now() + 30 * DAY;
    await prisma.scheduledSession.createMany({
      data: Array.from({ length: 18 }, (_, i) => ({ roomId: room.id, startsAt: new Date(base + i * HOUR), durationMin: 30 })),
    });
    const results = await Promise.all(
      [1, 2, 3, 4].map((n) => admin.agent.post(`/rooms/${room.id}/schedule`).send({ startsAt: inFuture(n * DAY), durationMin: 30 }))
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2); // 18 + 2 = 20
    const refused = results.filter((r) => r.status === 409);
    expect(refused).toHaveLength(2);
    expect(refused[0].body.code).toBe("CONFLICT");
    expect(await prisma.scheduledSession.count({ where: { roomId: room.id } })).toBe(20);

    // Deleting one makes room for another.
    const [first] = await prisma.scheduledSession.findMany({ where: { roomId: room.id }, take: 1 });
    await admin.agent.delete(`/rooms/${room.id}/schedule/${first.id}`).expect(204);
    await admin.agent.post(`/rooms/${room.id}/schedule`).send({ startsAt: inFuture(9 * DAY), durationMin: 30 }).expect(201);
  });

  it("does not count finished sessions toward the cap", async () => {
    const { admin, room } = await setup("cap-past");
    await prisma.scheduledSession.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({ roomId: room.id, startsAt: new Date(Date.now() - (2 + i) * HOUR), durationMin: 30 })),
    });
    await admin.agent.post(`/rooms/${room.id}/schedule`).send({ startsAt: inFuture(DAY), durationMin: 30 }).expect(201);
  });

  it("updates start and/or duration, and rejects empty or invalid changes", async () => {
    const { admin, room } = await setup("patch");
    const created = (await admin.agent.post(`/rooms/${room.id}/schedule`).send({ startsAt: inFuture(DAY), durationMin: 60 }).expect(201)).body.session;
    const path = `/rooms/${room.id}/schedule/${created.id}`;

    const onlyDuration = await admin.agent.patch(path).send({ durationMin: 90 }).expect(200);
    expect(onlyDuration.body.session).toEqual({ ...created, durationMin: 90 });
    const newStart = inFuture(2 * DAY);
    const both = await admin.agent.patch(path).send({ startsAt: newStart, durationMin: 20 }).expect(200);
    expect(both.body.session).toMatchObject({ id: created.id, startsAt: newStart, durationMin: 20, createdById: admin.id });

    expect((await admin.agent.patch(path).send({})).body.code).toBe("VALIDATION_ERROR");
    expect((await admin.agent.patch(path).send({ durationMin: 5 })).status).toBe(400);
    expect((await admin.agent.patch(path).send({ startsAt: inFuture(-HOUR) })).status).toBe(400);
    expect((await admin.agent.patch(`/rooms/${room.id}/schedule/${randomUUID()}`).send({ durationMin: 30 })).status).toBe(404);
    expect((await admin.agent.patch(`/rooms/${room.id}/schedule/not-a-uuid`).send({ durationMin: 30 })).status).toBe(404);
  });

  it("can't touch another room's sessions through this room's URL", async () => {
    const { admin, room } = await setup("cross");
    const elsewhere = await roomWith(admin, "Elsewhere");
    const theirs = await addSession(elsewhere.id, new Date(Date.now() + DAY));
    const patch = await admin.agent.patch(`/rooms/${room.id}/schedule/${theirs.id}`).send({ durationMin: 99 });
    expect(patch.status).toBe(404);
    expect(patch.body.code).toBe("SCHEDULE_NOT_FOUND");
    expect((await admin.agent.delete(`/rooms/${room.id}/schedule/${theirs.id}`)).status).toBe(404);
    expect(await prisma.scheduledSession.findUniqueOrThrow({ where: { id: theirs.id } })).toMatchObject({ durationMin: 30 });
  });

  it("deletes a session once", async () => {
    const { admin, room } = await setup("delete");
    const created = (await admin.agent.post(`/rooms/${room.id}/schedule`).send({ startsAt: inFuture(DAY), durationMin: 60 }).expect(201)).body.session;
    await admin.agent.delete(`/rooms/${room.id}/schedule/${created.id}`).expect(204);
    await admin.agent.delete(`/rooms/${room.id}/schedule/${created.id}`).expect(404);
    expect((await admin.agent.get(`/rooms/${room.id}/schedule`)).body.sessions).toEqual([]);
  });

  it("removes sessions that ended more than a week ago, and keeps newer ones", async () => {
    const { member, room } = await setup("prune");
    const old = await addSession(room.id, new Date(Date.now() - 8 * DAY), 60);
    const recent = await addSession(room.id, new Date(Date.now() - 6 * DAY), 60);
    // Started 7 days + 30 min ago but lasts 4 hours, so it ended just under 7 days ago: must stay.
    await addSession(room.id, new Date(Date.now() - 7 * DAY - 30 * 60_000), 240);
    const edge = await addSession(room.id, new Date(Date.now() - 7 * DAY - 5 * HOUR), 240); // ended 1 hour past the week

    await member.agent.get(`/rooms/${room.id}/schedule`).expect(200);
    expect(await prisma.scheduledSession.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.scheduledSession.findUnique({ where: { id: edge.id } })).toBeNull();
    expect(await prisma.scheduledSession.findUnique({ where: { id: recent.id } })).not.toBeNull();
    expect(await prisma.scheduledSession.count({ where: { roomId: room.id } })).toBe(2);
  });

  it("limits schedule writes per user", async () => {
    const limited = createApp({ rateLimits: { scheduleWritePerUser: { windowMs: 60_000, max: 2 } } });
    const admin = await registerUser(limited, newEmail("rl-admin"), "Admin");
    const room = await roomWith(admin, "Limited");
    for (let i = 1; i <= 2; i++) {
      await admin.agent.post(`/rooms/${room.id}/schedule`).send({ startsAt: inFuture(i * DAY), durationMin: 30 }).expect(201);
    }
    const res = await admin.agent.post(`/rooms/${room.id}/schedule`).send({ startsAt: inFuture(3 * DAY), durationMin: 30 });
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
    await admin.agent.get(`/rooms/${room.id}/schedule`).expect(200);
  });

  it("shows a deleted creator as createdById null", async () => {
    const { member, room } = await setup("orphan");
    await addSession(room.id, new Date(Date.now() + DAY), 30, null);
    const res = await member.agent.get(`/rooms/${room.id}/schedule`).expect(200);
    expect(res.body.sessions[0].createdById).toBeNull();
  });
});

describe("GET /schedule/upcoming", () => {
  const app = createApp();

  it("merges my rooms' sessions soonest first with the room name, and skips other rooms", async () => {
    const me = await registerUser(app, newEmail("up-me"), "Me");
    const other = await registerUser(app, newEmail("up-other"), "Other");
    const roomA = await roomWith(me, "Alpha");
    const roomB = await roomWith(other, "Beta", [me]);
    const hidden = await roomWith(other, "Hidden");

    const third = await addSession(roomA.id, new Date(Date.now() + 3 * DAY), 60, me.id);
    const first = await addSession(roomB.id, new Date(Date.now() + DAY), 45, other.id);
    const second = await addSession(roomA.id, new Date(Date.now() + 2 * DAY), 30, null);
    await addSession(hidden.id, new Date(Date.now() + HOUR));
    await addSession(roomA.id, new Date(Date.now() - 3 * HOUR), 30); // already over

    const res = await me.agent.get("/schedule/upcoming").expect(200);
    expect(res.body.sessions).toEqual([
      { id: first.id, roomId: roomB.id, roomName: "Beta", startsAt: first.startsAt.toISOString(), durationMin: 45, createdById: other.id },
      { id: second.id, roomId: roomA.id, roomName: "Alpha", startsAt: second.startsAt.toISOString(), durationMin: 30, createdById: null },
      { id: third.id, roomId: roomA.id, roomName: "Alpha", startsAt: third.startsAt.toISOString(), durationMin: 60, createdById: me.id },
    ]);
  });

  it("defaults to 10, honours limit 1..20, and rejects anything else", async () => {
    const me = await registerUser(app, newEmail("up-limit"), "Limit");
    const room = await roomWith(me, "Many");
    await prisma.scheduledSession.createMany({
      data: Array.from({ length: 15 }, (_, i) => ({ roomId: room.id, startsAt: new Date(Date.now() + (i + 1) * HOUR), durationMin: 30 })),
    });
    expect((await me.agent.get("/schedule/upcoming")).body.sessions).toHaveLength(10);
    expect((await me.agent.get("/schedule/upcoming?limit=3")).body.sessions).toHaveLength(3);
    expect((await me.agent.get("/schedule/upcoming?limit=20")).body.sessions).toHaveLength(15);
    for (const bad of ["0", "21", "x", "2.5"]) {
      expect((await me.agent.get(`/schedule/upcoming?limit=${bad}`)).status, `limit=${bad}`).toBe(400);
    }
  });

  it("is empty for someone with no rooms", async () => {
    const lonely = await registerUser(app, newEmail("up-lonely"), "Lonely");
    expect((await lonely.agent.get("/schedule/upcoming").expect(200)).body).toEqual({ sessions: [] });
  });

  it("prunes week-old sessions in my rooms as a side effect", async () => {
    const me = await registerUser(app, newEmail("up-prune"), "Prune");
    const room = await roomWith(me, "Prune");
    const old = await addSession(room.id, new Date(Date.now() - 9 * DAY), 30);
    await me.agent.get("/schedule/upcoming").expect(200);
    expect(await prisma.scheduledSession.findUnique({ where: { id: old.id } })).toBeNull();
  });
});
