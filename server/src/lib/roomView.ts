import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { resolveSession } from "./fsm.js";

export const roomInclude = {
  session: true,
  participants: { include: { user: { select: { id: true, displayName: true } } } },
} satisfies Prisma.RoomInclude;

export type RoomWithRelations = Prisma.RoomGetPayload<{ include: typeof roomInclude }>;

export function serializeRoom(room: RoomWithRelations) {
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    adminId: room.adminId,
    inviteEnabled: room.inviteEnabled,
    capacity: room.capacity,
    session: room.session,
    participants: room.participants.map((p) => ({
      userId: p.userId,
      displayName: p.user.displayName,
      role: p.role,
      joinedAt: p.joinedAt,
      cameraOn: p.cameraOn,
      micOn: p.micOn,
    })),
  };
}

/** Re-derives the live timer snapshot and persists it if it advanced past a phase boundary. */
export async function resolveAndLoadRoom(roomId: string): Promise<RoomWithRelations | null> {
  const room = await prisma.room.findUnique({ where: { id: roomId }, include: roomInclude });
  if (!room || !room.session) return room;

  const patch = resolveSession(room.session, new Date());
  if (Object.keys(patch).length === 0) return room;

  const session = await prisma.pomodoroSession.update({ where: { roomId }, data: patch });
  return { ...room, session };
}
