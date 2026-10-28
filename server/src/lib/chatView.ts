/** What a chat line looks like to clients, in REST responses and WebSocket pushes alike. */
export interface ChatMessage {
  id: string;
  /** Null once the author deleted their account. */
  userId: string | null;
  displayName: string;
  body: string;
  createdAt: string;
}

/** Shown wherever a name would be, once the account behind a message, document or session is gone. */
export const DELETED_USER_NAME = "Deleted user";

export function serializeChatMessage(message: {
  id: string;
  authorId: string | null;
  body: string;
  createdAt: Date;
  author: { displayName: string } | null;
}): ChatMessage {
  return {
    id: message.id,
    userId: message.authorId,
    displayName: message.author?.displayName ?? DELETED_USER_NAME,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  };
}
