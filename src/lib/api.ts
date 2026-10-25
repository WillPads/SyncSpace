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

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
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
    throw new ApiError("Can't reach the SyncSpace server.", 0);
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    // The proxy answers with a non-JSON 5xx when the server process isn't running.
    const message = data?.error ?? (res.status >= 500 ? "Can't reach the SyncSpace server." : "Something went wrong.");
    throw new ApiError(message, res.status);
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
