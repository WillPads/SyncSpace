import { z } from "zod";
import type { SerializedRoom } from "../lib/roomView.js";

/**
 * The room WebSocket protocol, shared by every client (web, mobile, desktop).
 * All frames are JSON text with a `type` discriminator; unknown types should be ignored.
 */
export const PROTOCOL_VERSION = 1;

export type SignalingType = "webrtc:offer" | "webrtc:answer" | "webrtc:ice-candidate";

export interface DocumentUpdate {
  id: string;
  filename: string;
  status: "PENDING" | "PARSING" | "READY" | "FAILED";
  failureReason: string | null;
}

export type ServerMessage =
  /** First frame on every connection. */
  | {
      type: "hello";
      protocolVersion: number;
      roomId: string;
      userId: string;
      serverTime: number;
      heartbeatIntervalMs: number;
    }
  /** Full room snapshot: after every change, and as a sync pulse every WS_TICK_MS while anyone is connected. */
  | { type: "room:update"; room: SerializedRoom }
  | { type: "room:deleted"; roomId: string }
  | { type: "presence:sync"; onlineUserIds: string[] }
  | { type: "presence:joined"; userId: string }
  | { type: "presence:left"; userId: string }
  | { type: "document:update"; document: DocumentUpdate }
  | { type: "quiz:ready"; documentId: string; quizId: string }
  /** Reply to time:ping. With the round trip, clients can estimate their clock offset (NTP-style). */
  | { type: "time:pong"; clientTime: number; serverTime: number }
  /** A relayed WebRTC signal. The server never reads `payload`. */
  | { type: SignalingType; from: string; payload: unknown }
  | { type: "webrtc:peer-unavailable"; userId: string }
  | { type: "error"; code: string; message: string };

const signalSchema = <T extends SignalingType>(type: T) =>
  z.object({ type: z.literal(type), to: z.string().uuid(), payload: z.unknown() });

export const clientMessageSchema = z.discriminatedUnion("type", [
  signalSchema("webrtc:offer"),
  signalSchema("webrtc:answer"),
  signalSchema("webrtc:ice-candidate"),
  z.object({ type: z.literal("time:ping"), clientTime: z.number() }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** Close codes (4000-4999 are application-defined). */
export const CloseCode = {
  /** Session signed out or revoked. Reconnecting needs a new sign-in. */
  SignedOut: 4001,
  /** Removed from the room or left it. */
  NotAParticipant: 4003,
  RoomDeleted: 4004,
} as const;
