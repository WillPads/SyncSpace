import type {
  DocumentStatus,
  Quiz,
  QuizResult,
  QuizSummary,
  Room,
  RoomDocument,
  SessionAction,
  User,
} from "@/lib/types";

// Proxied to the SyncSpace server by the rewrite in next.config.ts, so requests are
// same-origin and the auth cookie rides along without any CORS setup.
export const API_BASE = "/backend";

/** Shown when our API didn't answer: the network is down, or a proxy/host page came back instead of JSON. */
export const UNREACHABLE_MESSAGE = "Can't reach the SyncSpace server. Try again in a minute.";

export class ApiError extends Error {
  status: number;
  /** The server's stable error code (e.g. "INVALID_CREDENTIALS"); undefined when the server never answered. */
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: init.body && !isForm ? { "Content-Type": "application/json", ...init.headers } : init.headers,
    });
  } catch {
    throw new ApiError(UNREACHABLE_MESSAGE, 0);
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & { error?: string; code?: string }) | null;
  if (!res.ok) {
    // Every error from our API is JSON with an `error` sentence. A body without one (an HTML 404 or 5xx
    // from the host or proxy) means the request never reached our server, so say that instead.
    throw new ApiError(data?.error ?? UNREACHABLE_MESSAGE, res.status, data?.code);
  }
  return data as T;
}

function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
}

const room = (res: { room: Room }) => res.room;

export const api = {
  me: () => request<{ user: User }>("/auth/me").then((res) => res.user),
  login: (email: string, password: string) =>
    send<{ user: User }>("POST", "/auth/login", { email, password }).then((res) => res.user),
  register: (email: string, password: string, displayName: string) =>
    send<{ user: User }>("POST", "/auth/register", { email, password, displayName }).then((res) => res.user),
  logout: () => send<void>("POST", "/auth/logout"),
  wsTicket: () => request<{ ticket: string }>("/auth/ws-ticket").then((res) => res.ticket),

  listRooms: () => request<{ rooms: Room[] }>("/rooms").then((res) => res.rooms),
  createRoom: (input: { name: string; focusDurationSec: number; breakDurationSec: number; inviteEnabled: boolean }) =>
    send<{ room: Room }>("POST", "/rooms", input).then(room),
  joinRoom: (code: string) => send<{ room: Room }>("POST", `/rooms/${encodeURIComponent(code)}/join`, {}).then(room),
  getRoom: (roomId: string) => request<{ room: Room }>(`/rooms/${roomId}`).then(room),
  sessionAction: (roomId: string, action: SessionAction) =>
    send<{ room: Room }>("POST", `/rooms/${roomId}/session`, { action }).then(room),
  setInvite: (roomId: string, enabled: boolean) =>
    send<{ room: Room }>("PATCH", `/rooms/${roomId}/invite`, { enabled }).then(room),
  updateTask: (roomId: string, task: string) =>
    send<{ room: Room }>("PATCH", `/rooms/${roomId}/task`, { task }).then(room),
  removeParticipant: (roomId: string, userId: string) =>
    send<{ room: Room }>("DELETE", `/rooms/${roomId}/participants/${userId}`).then(room),

  listDocuments: (roomId: string) =>
    request<{ documents: RoomDocument[] }>(`/rooms/${roomId}/documents`).then((res) => res.documents),
  uploadDocument: (roomId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ document: RoomDocument }>(`/rooms/${roomId}/documents`, { method: "POST", body: form }).then(
      (res) => res.document
    );
  },
  listQuizzes: (roomId: string) =>
    request<{ quizzes: QuizSummary[] }>(`/rooms/${roomId}/quizzes`).then((res) => res.quizzes),
  getQuiz: (roomId: string, quizId: string) =>
    request<{ quiz: Quiz }>(`/rooms/${roomId}/quizzes/${quizId}`).then((res) => res.quiz),
  submitAttempt: (roomId: string, quizId: string, responses: { questionId: string; choiceId: string }[]) =>
    send<QuizResult>("POST", `/rooms/${roomId}/quizzes/${quizId}/attempts`, { responses }),
};

export function isProcessing(status: DocumentStatus): boolean {
  return status === "PENDING" || status === "PARSING";
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong.";
}

// ---------------------------------------------------------------------------------------------
// Dashboard features: notepad, quick note, recent files and upcoming sessions.
// Kept apart from `api` above so the older calls stay untouched.
// ---------------------------------------------------------------------------------------------

export interface Note {
  id: string;
  text: string;
  createdAt: string;
}

export interface NotesResponse {
  notes: Note[]; // newest first
  limit: number; // how many notes the notepad holds (5)
}

export interface QuickNote {
  text: string;
  updatedAt: string | null; // null until the first save
}

/** One row of "Recent files": an upload from any room the user is in. */
export interface DashboardFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null; // null for files uploaded before sizes were recorded
  status: DocumentStatus;
  failureReason: string | null;
  createdAt: string;
  roomId: string;
  roomName: string;
  quizId: string | null;
  questionCount: number | null;
  uploadedById: string | null; // null once the uploader deleted their account
  canDelete: boolean; // you uploaded it or you host the room: the same rule the delete route enforces
}

export interface UpcomingSession {
  id: string;
  roomId: string;
  roomName: string;
  startsAt: string;
  durationMin: number;
  createdById: string | null;
}

export const dashboardApi = {
  listNotes: () => request<NotesResponse>("/me/notes"),
  addNote: (text: string) => send<{ note: Note }>("POST", "/me/notes", { text }).then((res) => res.note),
  deleteNote: (id: string) => send<void>("DELETE", `/me/notes/${encodeURIComponent(id)}`),

  getQuickNote: () => request<QuickNote>("/me/quick-note"),
  // `keepalive` lets the browser finish the request even while the page is closing or reloading.
  saveQuickNote: (text: string, keepalive = false) =>
    request<QuickNote>("/me/quick-note", { method: "PUT", body: JSON.stringify({ text }), keepalive }),

  listMyDocuments: (limit = 6) =>
    request<{ documents: DashboardFile[] }>(`/me/documents?limit=${limit}`).then((res) => res.documents),
  deleteDocument: (roomId: string, documentId: string) =>
    send<void>("DELETE", `/rooms/${encodeURIComponent(roomId)}/documents/${encodeURIComponent(documentId)}`),

  listUpcoming: (limit = 10) =>
    request<{ sessions: UpcomingSession[] }>(`/schedule/upcoming?limit=${limit}`).then((res) => res.sessions),
  scheduleSession: (roomId: string, input: { startsAt: string; durationMin: number }) =>
    send<{ session: unknown }>("POST", `/rooms/${encodeURIComponent(roomId)}/schedule`, input),
  deleteScheduledSession: (roomId: string, sessionId: string) =>
    send<void>("DELETE", `/rooms/${encodeURIComponent(roomId)}/schedule/${encodeURIComponent(sessionId)}`),
};

/** Like errorMessage, but a 429 gets a plain "slow down" sentence instead of the server's wording. */
export function friendlyError(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) return "You're doing that too often. Wait a bit and try again.";
  return errorMessage(error);
}

// ---------------------------------------------------------------------------------------------
// Room chat. Writes (send, delete) and history go over REST; new messages are pushed to the room
// over the WebSocket (see hooks/useLiveRoom.ts and hooks/useRoomChat.ts).
// ---------------------------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  userId: string | null; // null once the author deleted their account
  displayName: string; // "Deleted user" when userId is null
  body: string; // plain text
  createdAt: string; // ISO timestamp
}

export interface ChatPage {
  messages: ChatMessage[]; // oldest first within the page
  nextBefore: string | null; // pass as `before` to get the next older page; null when there is none
}

/** The server's limit for one message, after trimming. */
export const CHAT_MAX_LENGTH = 500;

export const chatApi = {
  list: (roomId: string, options: { before?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", String(options.limit));
    if (options.before) params.set("before", options.before);
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return request<ChatPage>(`/rooms/${encodeURIComponent(roomId)}/messages${query}`);
  },
  send: (roomId: string, body: string) =>
    send<{ message: ChatMessage }>("POST", `/rooms/${encodeURIComponent(roomId)}/messages`, { body }).then(
      (res) => res.message
    ),
  remove: (roomId: string, messageId: string) =>
    send<void>("DELETE", `/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`),
};

// ---------------------------------------------------------------------------------------------
// Account settings: profile, password, delete account. A wrong password is a 403 (never 401), so
// callers must show it as a field error and must not treat it as "signed out".
// ---------------------------------------------------------------------------------------------

/** The server's minimum for a new password (the same rule as sign-up). */
export const MIN_PASSWORD_LENGTH = 8;

export const accountApi = {
  /** Send only what changed. `currentPassword` is required by the server when `email` is sent. */
  updateProfile: (input: { displayName?: string; email?: string; currentPassword?: string }) =>
    send<{ user: User }>("PATCH", "/auth/me", input).then((res) => res.user),
  /** 204. Signs out every other device; this one stays signed in. */
  changePassword: (currentPassword: string, newPassword: string) =>
    send<void>("POST", "/auth/change-password", { currentPassword, newPassword }),
  /** 204 and the server clears the cookie. Irreversible. */
  deleteAccount: (password: string) => send<void>("POST", "/auth/delete-account", { password }),
};
