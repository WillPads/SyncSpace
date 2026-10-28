/**
 * Who may delete an uploaded file: the uploader, or the room admin.
 * If the uploader's account is gone (uploadedById is null), only the admin can.
 *
 * This is the single source of truth: DELETE /rooms/:roomId/documents/:documentId enforces it and
 * GET /me/documents reports it as `canDelete`, so the two can't disagree.
 */
export function canDeleteDocument(userId: string, roomRole: string, uploadedById: string | null): boolean {
  return roomRole === "ADMIN" || (uploadedById !== null && uploadedById === userId);
}
