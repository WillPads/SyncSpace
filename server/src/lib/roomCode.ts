const ROOM_CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 5;

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_CHARSET[Math.floor(Math.random() * ROOM_CODE_CHARSET.length)];
  }
  return code;
}

export async function uniqueRoomCode(exists: (code: string) => Promise<boolean>): Promise<string> {
  let code = generateRoomCode();
  while (await exists(code)) {
    code = generateRoomCode();
  }
  return code;
}
