export type SessionMode = "focus" | "break";

export type ParticipantStatus = "focused" | "on-break" | "idle" | "away";

export interface TimerState {
  mode: SessionMode;
  durationSeconds: number;
  remainingSeconds: number;
  isRunning: boolean;
  updatedAt: number;
  sessionsCompleted: number;
}

export interface Participant {
  id: string;
  name: string;
  colorIndex: number;
  status: ParticipantStatus;
  task: string;
  isHost: boolean;
  joinedAt: number;
  lastSeenAt: number;
}

export interface Room {
  id: string;
  name: string;
  createdAt: number;
  hostId: string;
  timer: TimerState;
  participants: Participant[];
}

export interface RoomPayload {
  room: Room;
  participantId: string;
}

export interface ApiError {
  error: string;
}
