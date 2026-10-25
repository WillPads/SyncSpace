// Shapes returned by the SyncSpace server (server/src). Dates arrive as ISO strings.

export type Role = "ADMIN" | "MEMBER";
export type SessionState = "IDLE" | "POMODORO_ACTIVE" | "BREAK" | "QUIZ_PHASE";
export type SessionAction = "start" | "pause" | "resume" | "skip" | "endSession" | "reset";
export type DocumentStatus = "PENDING" | "PARSING" | "READY" | "FAILED";

export interface User {
  id: string;
  email: string;
  displayName: string;
}

export interface Session {
  state: SessionState;
  focusDurationSec: number;
  breakDurationSec: number;
  remainingSeconds: number;
  isRunning: boolean;
  updatedAt: string;
  sessionsCompleted: number;
}

export interface Participant {
  userId: string;
  displayName: string;
  role: Role;
  task: string;
  joinedAt: string;
  cameraOn: boolean;
  micOn: boolean;
}

export interface Room {
  id: string;
  code: string;
  name: string;
  adminId: string;
  inviteEnabled: boolean;
  capacity: number;
  session: Session | null;
  participants: Participant[];
}

export interface RoomDocument {
  id: string;
  filename: string;
  mimeType: string;
  status: DocumentStatus;
  createdAt: string;
}

export interface QuizSummary {
  id: string;
  title: string;
  documentId: string;
  createdAt: string;
  questionCount: number;
}

export interface Quiz {
  id: string;
  title: string;
  questions: { id: string; prompt: string; choices: { id: string; text: string }[] }[];
}

export interface QuizResult {
  attemptId: string;
  score: number;
  total: number;
  correctChoices: Record<string, string | undefined>;
}
