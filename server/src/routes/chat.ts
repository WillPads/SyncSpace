import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { serializeChatMessage } from "../lib/chatView.js";
import { HttpError, fieldError, hasNoNulBytes, isUuid, parseInput, parseLimit, routeParam } from "../lib/http.js";
import { type RateLimiters, limitBy } from "../lib/rateLimit.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRoomRole } from "../middleware/requireRoomRole.js";
import { sendToRoom } from "../ws/registry.js";

/** A room keeps its newest this-many messages; older ones are deleted as new ones arrive. */
export const MAX_MESSAGES_PER_ROOM = 500;
const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;

const postSchema = z.object({
  body: z
    .string(fieldError("Message", "text"))
    .trim()
    .min(1, "A message can't be empty.")
    .max(500, "A message can be at most 500 characters.")
    .refine(hasNoNulBytes, "That message contains characters that can't be sent."),
});

const authorSelect = { select: { displayName: true } } as const;
const messageNotFound = () => new HttpError(404, "MESSAGE_NOT_FOUND", "Message not found.");

export function createChatRouter(limits: RateLimiters): Router {
  const router = Router();

  // Newest page by default; pass the previous response's `nextBefore` as `before` to go further back.
  // Messages are ordered by (createdAt, id): the id breaks ties, so messages sent in the same
  // millisecond keep a fixed order and a page boundary can never skip or repeat one.
  router.get("/:roomId/messages", requireAuth, requireRoomRole("ADMIN", "MEMBER"), async (req, res) => {
    const roomId = routeParam(req, "roomId");
    const limit = parseLimit(req.query.limit, DEFAULT_PAGE, MAX_PAGE);
    const before = req.query.before;
    if (before !== undefined && typeof before !== "string") {
      throw new HttpError(400, "INVALID_CURSOR", "before must be a message id.");
    }

    let olderThan: { createdAt: Date; id: string } | null = null;
    if (before !== undefined) {
      const cursor = isUuid(before)
        ? await prisma.chatMessage.findFirst({ where: { id: before, roomId }, select: { createdAt: true, id: true } })
        : null;
      if (!cursor) throw new HttpError(400, "INVALID_CURSOR", "That message isn't in this room's history.");
      olderThan = cursor;
    }

    const rows = await prisma.chatMessage.findMany({
      where: {
        roomId,
        ...(olderThan && {
          OR: [
            { createdAt: { lt: olderThan.createdAt } },
            { createdAt: olderThan.createdAt, id: { lt: olderThan.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1, // one extra row, only to learn whether there is an older page
      include: { author: authorSelect },
    });
    const page = rows.slice(0, limit);
    res.json({
      messages: page.reverse().map(serializeChatMessage),
      nextBefore: rows.length > limit ? page[0].id : null,
    });
  });

  router.post(
    "/:roomId/messages",
    requireAuth,
    requireRoomRole("ADMIN", "MEMBER"),
    limitBy(limits.chatPerUser, (req) => req.user?.id ?? null, "You're sending messages too quickly. Slow down."),
    async (req, res) => {
      const { body } = parseInput(postSchema, req.body);
      const roomId = routeParam(req, "roomId");

      const message = await prisma.$transaction(async (tx) => {
        const created = await tx.chatMessage.create({
          data: { roomId, authorId: req.user!.id, body },
          include: { author: authorSelect },
        });
        // Keep only the newest MAX_MESSAGES_PER_ROOM: whatever sorts after that position goes.
        const overflow = await tx.chatMessage.findMany({
          where: { roomId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: MAX_MESSAGES_PER_ROOM,
          select: { id: true },
        });
        if (overflow.length > 0) {
          await tx.chatMessage.deleteMany({ where: { id: { in: overflow.map((row) => row.id) } } });
        }
        return created;
      });

      const payload = serializeChatMessage(message);
      sendToRoom(roomId, { type: "chat:message", message: payload });
      res.status(201).json({ message: payload });
    }
  );

  // The author can delete their own line; the room admin can delete anyone's (and a deleted user's).
  router.delete("/:roomId/messages/:messageId", requireAuth, requireRoomRole("ADMIN", "MEMBER"), async (req, res) => {
    const roomId = routeParam(req, "roomId");
    const messageId = routeParam(req, "messageId");
    if (!isUuid(messageId)) throw messageNotFound();

    const message = await prisma.chatMessage.findFirst({ where: { id: messageId, roomId }, select: { authorId: true } });
    if (!message) throw messageNotFound();
    const isAuthor = message.authorId !== null && message.authorId === req.user!.id;
    if (!isAuthor && req.participant!.role !== "ADMIN") {
      throw new HttpError(403, "FORBIDDEN", "You can only delete your own messages.");
    }

    const { count } = await prisma.chatMessage.deleteMany({ where: { id: messageId, roomId } });
    if (count === 0) throw messageNotFound();
    sendToRoom(roomId, { type: "chat:deleted", messageId });
    res.status(204).end();
  });

  return router;
}
