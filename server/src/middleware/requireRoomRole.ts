import type { Role } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db.js";
import { HttpError, isUuid, routeParam } from "../lib/http.js";

declare module "express-serve-static-core" {
  interface Request {
    participant?: { roomId: string; userId: string; role: Role };
  }
}

/**
 * Must run after requireAuth. Reads the room id from req.params.roomId and re-checks
 * membership in the database on every request, so a removal takes effect immediately.
 */
export function requireRoomRole(...allowedRoles: Role[]) {
  return async function (req: Request, _res: Response, next: NextFunction): Promise<void> {
    if (!req.user) throw new HttpError(401, "UNAUTHENTICATED", "Not authenticated.");

    const roomId = routeParam(req, "roomId");
    if (!isUuid(roomId)) throw new HttpError(404, "ROOM_NOT_FOUND", "Room not found.");

    const participant = await prisma.participant.findUnique({
      where: { roomId_userId: { roomId, userId: req.user.id } },
      select: { roomId: true, userId: true, role: true },
    });
    if (!participant) throw new HttpError(403, "NOT_A_MEMBER", "You are not a member of this room.");
    if (!allowedRoles.includes(participant.role)) {
      throw new HttpError(403, "FORBIDDEN", "You do not have permission to do that.");
    }

    req.participant = participant;
    next();
  };
}
