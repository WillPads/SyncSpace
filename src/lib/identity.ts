const NAME_KEY = "syncspace:name";

function participantKey(roomId: string): string {
  return `syncspace:room:${roomId.toUpperCase()}:participantId`;
}

export function getStoredName(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(NAME_KEY) ?? "";
}

export function storeName(name: string): void {
  if (typeof window === "undefined" || !name.trim()) return;
  window.localStorage.setItem(NAME_KEY, name.trim());
}

export function getStoredParticipantId(roomId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(participantKey(roomId));
}

export function storeParticipantId(roomId: string, participantId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(participantKey(roomId), participantId);
}

export function clearParticipantId(roomId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(participantKey(roomId));
}
