import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { generateRoomCode } from "../src/lib/roomCode.js";

describe("prisma round-trip", () => {
  const suffix = randomUUID();
  const userId = { current: "" };
  const roomId = { current: "" };

  afterAll(async () => {
    if (roomId.current) {
      await prisma.pomodoroSession.deleteMany({ where: { roomId: roomId.current } });
      await prisma.room.delete({ where: { id: roomId.current } });
    }
    if (userId.current) {
      await prisma.user.delete({ where: { id: userId.current } });
    }
  });

  it("creates a User, Room, and PomodoroSession with resolvable relations", async () => {
    const user = await prisma.user.create({
      data: {
        email: `test-${suffix}@example.com`,
        passwordHash: "not-a-real-hash",
        displayName: "Test Admin",
      },
    });
    userId.current = user.id;

    const room = await prisma.room.create({
      data: {
        code: generateRoomCode(),
        name: "Test Room",
        adminId: user.id,
        session: {
          create: {
            focusDurationSec: 1500,
            breakDurationSec: 300,
            remainingSeconds: 1500,
          },
        },
      },
      include: { session: true, admin: true },
    });
    roomId.current = room.id;

    expect(room.admin.id).toBe(user.id);
    expect(room.session?.state).toBe("IDLE");
    expect(room.session?.remainingSeconds).toBe(1500);

    const found = await prisma.room.findUnique({
      where: { id: room.id },
      include: { session: true },
    });
    expect(found?.session?.roomId).toBe(room.id);
  });
});
