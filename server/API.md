# SyncSpace server API

Everything a client needs: web, Android, iOS or a script. All requests and responses are JSON (except file uploads), and all timestamps are ISO-8601 UTC strings.

## Authentication

Server-side sessions, stored in Postgres.

- `POST /auth/register` or `POST /auth/login` sets the cookie `syncspace_session` (HttpOnly, SameSite=Lax, Secure in production, 7 days). The cookie holds a random 256-bit token, and the database stores only its SHA-256 hash.
- Sessions slide: one that's used again after a day gets a fresh 7 days, and the cookie is re-sent.
- `POST /auth/logout` deletes the session row immediately. Any socket opened with that session closes with code `4001`.
- `POST /auth/logout-all` signs the user out on every device.
- Native apps: keep the cookie in the HTTP client's cookie store (OkHttp `CookieJar`, `URLSession`/`HTTPCookieStorage`). No other client-specific setup is needed.

### Opening the room socket

1. `GET /auth/ws-ticket` (authenticated) returns `{ ticket, expiresAt, expiresInSec }`. The ticket is single-use and valid for 30 seconds.
2. Connect to `wss://<server>/ws?roomId=<roomId>&ticket=<ticket>`.

As a same-origin fallback, the socket also accepts the session cookie, but only when the `Origin` header is one of `CLIENT_ORIGIN` (or absent, for non-browser clients).

The upgrade is refused with an HTTP status: `400` bad room id, `401` no or expired credentials, `403` not a member (or a foreign Origin), `404` wrong path.

## Errors

Every error response looks like this:

```json
{ "error": "Human-readable sentence, safe to show users.", "code": "STABLE_MACHINE_CODE" }
```

| Status | Typical codes |
| --- | --- |
| 400 | `VALIDATION_ERROR`, `INVALID_JSON`, `INVALID_FILE`, `INVALID_UPLOAD`, `UNSUPPORTED_FILE_TYPE`, `NO_FILE`, `INVALID_RESPONSE`, `INCOMPLETE_ATTEMPT`, `ADMIN_CANNOT_LEAVE` |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` |
| 403 | `NOT_A_MEMBER`, `FORBIDDEN`, `INVITES_DISABLED`, `REMOVED_FROM_ROOM` |
| 404 | `NOT_FOUND`, `ROOM_NOT_FOUND`, `QUIZ_NOT_FOUND`, `NOT_A_PARTICIPANT`, `NOT_BANNED` |
| 409 | `EMAIL_TAKEN`, `ROOM_FULL`, `INVALID_TRANSITION`, `NOT_QUIZ_PHASE`, `CONFLICT` |
| 413 | `FILE_TOO_LARGE`, `PAYLOAD_TOO_LARGE` |
| 429 | `RATE_LIMITED`, with a `Retry-After` header in seconds |
| 500 / 503 | `INTERNAL_ERROR`, `DATABASE_UNAVAILABLE` |

## REST endpoints

`A` = room admin only, `M` = any room member (admin included), `U` = any signed-in user.

| Method & path | Who | Body | Returns |
| --- | --- | --- | --- |
| `GET /health` | — | | `{ status }` (liveness; Render's health check) |
| `GET /health/ready` | — | | `{ status, database }`, 503 if the database is unreachable |
| `POST /auth/register` | — | `{ email, password (8+ chars, ≤72 bytes), displayName (≤40) }` | 201 `{ user }` |
| `POST /auth/login` | — | `{ email, password }` | `{ user }` |
| `POST /auth/logout` | — | | 204 |
| `POST /auth/logout-all` | U | | 204 |
| `GET /auth/me` | U | | `{ user }` |
| `GET /auth/ws-ticket` | U | | `{ ticket, expiresAt, expiresInSec }` |
| `GET /rooms` | U | | `{ rooms: Room[] }` (rooms you belong to) |
| `POST /rooms` | U | `{ name, focusDurationSec?, breakDurationSec?, inviteEnabled? }` | 201 `{ room }` |
| `POST /rooms/:code/join` | U | `{}` | 201 `{ room }` if newly joined, 200 if already in |
| `GET /rooms/:roomId` | M | | `{ room }` |
| `DELETE /rooms/:roomId` | A | | 204 (deletes everything in the room) |
| `PATCH /rooms/:roomId/invite` | A | `{ enabled }` | `{ room }` |
| `POST /rooms/:roomId/session` | A | `{ action, focusDurationSec?, breakDurationSec? }` | `{ room }` |
| `PATCH /rooms/:roomId/task` | M | `{ task (≤120) }` | `{ room }` |
| `PATCH /rooms/:roomId/media` | M | `{ cameraOn?, micOn? }` | `{ room }` |
| `DELETE /rooms/:roomId/participants/:userId` | A, or M for themselves | | `{ room }` (an admin removal also bans) |
| `GET /rooms/:roomId/bans` | A | | `{ bans: [{ userId, displayName, createdAt }] }` |
| `DELETE /rooms/:roomId/bans/:userId` | A | | 204 |
| `POST /rooms/:roomId/documents` | M | multipart, field `file` (.txt, .md, .pdf, ≤4 MB) | 201 `{ document }` |
| `GET /rooms/:roomId/documents` | M | | `{ documents }` |
| `GET /rooms/:roomId/quizzes` | M | | `{ quizzes: [{ id, title, documentId, generatedBy, createdAt, questionCount }] }` |
| `GET /rooms/:roomId/quizzes/:quizId` | M | | `{ quiz: { id, title, generatedBy, questions: [{ id, prompt, choices: [{ id, text }] }] } }` |
| `POST /rooms/:roomId/quizzes/:quizId/attempts` | M | `{ responses: [{ questionId, choiceId }] }` | 201 `{ attemptId, score, total, correctChoices }` |
| `GET /rooms/:roomId/quizzes/:quizId/results` | M | | `{ total, results: [{ userId, displayName, firstScore, bestScore, attempts, firstCompletedAt }] }` |

### Room

```jsonc
{
  "id": "uuid", "code": "K7Q2M", "name": "Deep Work", "adminId": "uuid",
  "inviteEnabled": true,      // whether people can join with the code
  "capacity": 10,             // hard limit, including the admin
  "serverTime": "…",          // server clock when the snapshot was taken
  "session": {
    "state": "IDLE | POMODORO_ACTIVE | BREAK | QUIZ_PHASE",
    "isRunning": true,
    "focusDurationSec": 1500, "breakDurationSec": 300,
    "remainingSeconds": 1432.5, // as of updatedAt
    "updatedAt": "…",
    "endsAt": "…",              // when the current phase ends (null unless running)
    "sessionsCompleted": 2,
    "version": 7                // bumped on every timer write
  },
  "participants": [{ "userId", "displayName", "role": "ADMIN | MEMBER", "task", "joinedAt", "cameraOn", "micOn" }]
}
```

`cameraOn` and `micOn` reset to `false` once someone has had no socket open in the room for 5 seconds.

### Room rules

- **Capacity:** at most 10 people. Joins are serialized with a row lock, so simultaneous joins can't overshoot.
- **Invites:** with `inviteEnabled: false`, nobody new can join with the code.
- **Bans:** someone the admin removes can't rejoin until the admin lifts the ban. Leaving on your own doesn't ban you.

### Timer state machine

All transitions are enforced by the server. Durations are whole seconds from 60 to 14400.

| Action | Allowed from | Result |
| --- | --- | --- |
| `start` | IDLE | POMODORO_ACTIVE, running |
| `pause` / `resume` | POMODORO_ACTIVE, BREAK | toggles running |
| `skip` | POMODORO_ACTIVE, BREAK | the other phase, full length |
| `endSession` | POMODORO_ACTIVE, BREAK | QUIZ_PHASE |
| `reset` | QUIZ_PHASE, IDLE | IDLE |

- While running, focus and break alternate on their own when a phase runs out. Clients never send times.
- Two simultaneous actions can't both apply. One wins, and the other is re-evaluated against the new state (usually a 409).

### Documents and quizzes

- **File checks:** the type comes from the extension and is then checked against the bytes. A PDF must have a `%PDF-` header. A text file must be UTF-8 or UTF-16 with no binary data.
- **Document lifecycle:** `PENDING → PARSING → READY | FAILED`. A FAILED document has a `failureReason` written for users. READY is set only once the quiz (if any) is saved.
- **Quiz generation:** Claude writes the quiz when `ANTHROPIC_API_KEY` is set, otherwise a built-in generator does. If a Claude call fails (network, rate limit, refusal, invalid output), the built-in generator is used instead. `generatedBy` says which one ran.
- **Submitting answers:** attempts are accepted only in `QUIZ_PHASE`, and must answer every question exactly once with one of that question's choices. Scoring happens on the server.
- **Results:** retakes are allowed. `firstScore` is the attempt that counts, because the answers are revealed after the first submission.

## WebSocket protocol (`/ws`)

All frames are JSON text with a `type`. Clients must ignore types they don't know.

### Server → client

| Type | Payload | When |
| --- | --- | --- |
| `hello` | `protocolVersion, roomId, userId, serverTime (ms), heartbeatIntervalMs` | first frame on every connection |
| `presence:sync` | `onlineUserIds` | right after `hello` |
| `presence:joined` / `presence:left` | `userId` | a user's first socket opens / last socket closes |
| `room:update` | `room` (as above) | after every change, and every second while anyone is connected |
| `room:deleted` | `roomId` | right before the socket closes with `4004` |
| `document:update` | `document: { id, filename, status, failureReason }` | every pipeline transition |
| `quiz:ready` | `documentId, quizId` | a quiz was generated |
| `time:pong` | `clientTime, serverTime` | reply to `time:ping` |
| `webrtc:offer` / `webrtc:answer` / `webrtc:ice-candidate` | `from, payload` | relayed from a peer |
| `webrtc:peer-unavailable` | `userId` | your signal's target isn't connected |
| `error` | `code, message` | a frame was malformed (the connection stays open) |

### Client → server

| Type | Payload |
| --- | --- |
| `time:ping` | `clientTime` (your clock, ms) |
| `webrtc:offer` / `webrtc:answer` / `webrtc:ice-candidate` | `to` (a user id in the room), `payload` (relayed untouched) |

### Clock sync

Every `room:update` carries `serverTime`, and `session.endsAt` is on the server's clock.

For drift within tens of milliseconds:

1. Send a few `time:ping` frames.
2. For each reply, compute `offset = serverTime - (clientTime + now) / 2`.
3. Keep the offset from the reply with the lowest round-trip time.
4. Show `endsAt - (Date.now() + offset)`.

Even without this, counting down from when each snapshot arrived is accurate to about one network latency.

### Limits and close codes

**Limits:**

- Frames can be at most 64 KB. A larger frame closes the socket with code `1009`.
- Inbound messages: bursts of up to 200, refilled at 50 per second. A client that floods past that is closed with code `1008`.
- The server pings every 30 seconds. A client that misses a pong is dropped, and the room gets `presence:left`.

**Close codes:**

| Code | Meaning |
| --- | --- |
| `4001` | Signed out or session revoked |
| `4003` | Removed from the room, or left it |
| `4004` | Room deleted |
| `1001` | Server restarting (reconnect) |

## Rate limits (per server instance)

| Action | Limit |
| --- | --- |
| Failed logins | 10 per 15 min per account (a success resets it) |
| Logins | 300 per 15 min per IP |
| Sign-ups | 100 per hour per IP |
| Room creation | 30 per hour per user |
| Joins | 30 per 10 min per user |
| Uploads | 20 per hour per user |
| WebSocket tickets | 30 per minute per user |

Per-IP limits depend on `TRUST_PROXY`, which decides which `X-Forwarded-For` entry becomes the client IP. Behind Vercel's rewrite and Render's Cloudflare edge, several users can appear to share one IP, which is why the per-IP limits are loose and the per-account and per-user limits do the real work. `TRUST_PROXY` stays at `1` (Render's load balancer).

## Configuration

See [`.env.example`](.env.example).

- **Required:** `DATABASE_URL` and `DIRECT_URL`.
- **Optional:** `PORT`, `CLIENT_ORIGIN`, `TRUST_PROXY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-opus-5-5`), `QUIZ_GENERATOR`, `WS_TICK_MS`, `UPLOAD_DIR`.
- **Startup check:** invalid configuration stops the server at boot with a list of the problems.
