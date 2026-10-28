import { prisma } from "../db.js";
import { closeRoom, disconnectUserEverywhere, hasClients, sendToRoom } from "../ws/registry.js";
import { forgetRoom, publishRoom } from "../ws/roomFeed.js";
import { removeUploads } from "./documentPipeline.js";

/**
 * Deletes an account without wrecking the rooms it leaves behind.
 *
 * Room.admin is ON DELETE RESTRICT, so a user who still admins a room can't be removed. For each
 * room they admin, the earliest-joined other participant takes over; a room with nobody else in it
 * is deleted. This all happens in one transaction, with each room row locked (the same
 * SELECT ... FOR UPDATE the join route uses), so a join can't land halfway through the decision.
 * Chat messages, documents, quizzes and scheduled sessions they made stay in the room: those
 * columns become NULL (shown as "Deleted user") rather than the rows disappearing. An upload still
 * waiting to be processed in such a room finishes normally; only the files of documents in a
 * deleted room are removed here, because those rows cascade away and the pipeline can't clean up.
 */
export async function deleteAccount(userId: string): Promise<void> {
  const outcome = await prisma.$transaction(async (tx) => {
    // Sorted so two deletions that touch the same rooms always lock them in the same order.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Room" WHERE "adminId" = ${userId} ORDER BY "id" FOR UPDATE`;

    const handedOver: string[] = [];
    const deleted: string[] = [];
    const orphanedUploads: string[] = [];

    for (const { id: roomId } of locked) {
      const successor = await tx.participant.findFirst({
        where: { roomId, userId: { not: userId } },
        orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
        select: { id: true, userId: true },
      });
      if (successor) {
        await tx.room.update({ where: { id: roomId }, data: { adminId: successor.userId } });
        await tx.participant.update({ where: { id: successor.id }, data: { role: "ADMIN" } });
        handedOver.push(roomId);
      } else {
        const pending = await tx.document.findMany({
          where: { roomId, status: { not: "READY" } },
          select: { storagePath: true },
        });
        orphanedUploads.push(...pending.map((doc) => doc.storagePath));
        await tx.room.delete({ where: { id: roomId } });
        deleted.push(roomId);
      }
    }

    // Rooms they only belong to: the others should see them leave.
    const memberships = await tx.participant.findMany({
      where: { userId, roomId: { notIn: [...handedOver, ...deleted] } },
      select: { roomId: true },
    });

    // Their unprocessed uploads in rooms that stay are NOT touched: the document keeps going with
    // uploadedById set to NULL, and the pipeline removes the file itself once it has read it.
    await tx.user.deleteMany({ where: { id: userId } });
    return { handedOver, deleted, left: memberships.map((m) => m.roomId), orphanedUploads };
  });

  // Only after the commit: tell the live connections what happened.
  disconnectUserEverywhere(userId);
  for (const roomId of outcome.deleted) {
    sendToRoom(roomId, { type: "room:deleted", roomId });
    closeRoom(roomId);
    forgetRoom(roomId);
  }
  await removeUploads(outcome.orphanedUploads);
  const changed = [...outcome.handedOver, ...outcome.left].filter((roomId) => hasClients(roomId));
  await Promise.all(
    changed.map((roomId) =>
      publishRoom(roomId).catch((err: unknown) => console.error(`Failed to publish room ${roomId}:`, err))
    )
  );
}
