import { randomInt } from "node:crypto";

// No 0/O or 1/I, so codes survive being read aloud or typed from a screenshot.
const ROOM_CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 5;
const ROOM_CODE_RE = new RegExp(`^[${ROOM_CODE_CHARSET}]{${ROOM_CODE_LENGTH}}$`);

/** A room code is the only thing needed to join a room with invites open, so it comes from a CSPRNG. */
export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_CHARSET[randomInt(ROOM_CODE_CHARSET.length)];
  }
  return code;
}

export function isRoomCode(value: string): boolean {
  return ROOM_CODE_RE.test(value);
}
