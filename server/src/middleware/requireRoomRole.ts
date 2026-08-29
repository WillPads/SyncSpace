import type { NextFunction, Request, Response } from "express";
import type { Role } from "@prisma/client";
import { prisma } from "../db.js";

declare module "express-serve-static-core" {
  interface Request {
    participant?: { roomId: string; userId: string; role: Role };
  }
}

/** Must run after requireAuth. Reads the room id from req.params.roomId. */
export function requireRoomRole(...allowedRoles: Role[]) {
  return async function (req: Request, res: Response, next: NextFunction) {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated." });
      return;
    }

    const roomId = req.params.roomId;
    const participant = await prisma.participant.findUnique({
      where: { roomId_userId: { roomId, userId: req.user.id } },
    });

    if (!participant) {
      res.status(403).json({ error: "You are not a member of this room." });
      return;
    }

    if (!allowedRoles.includes(participant.role)) {
      res.status(403).json({ error: "You do not have permission to do that." });
      return;
    }

    req.participant = participant;
    next();
  };
}
