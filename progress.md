# SyncSpace — build progress

Tracking the rebuild from the "SyncSpace" template (`gemini-code-1788013596192.md`): a separate Node.js
backend + real DB + WebSocket real-time engine + RBAC + WebRTC + async document/quiz pipeline, replacing
the previous in-memory/SWR-polling architecture. Full plan and rationale: see the approved plan this
build followed (monorepo layout, data model, per-step roadmap).

## Architecture decisions (locked in at Step 1)

- **Layout**: existing Next.js app stays at the repo root, untouched. New `server/` directory holds an
  independent Node.js + TypeScript + Express backend with its own `package.json`.
- **DB/ORM**: Prisma + SQLite (`server/prisma/dev.db`) — no Docker available in this environment, so no
  local Postgres/Redis. Datasource is swappable to Postgres later (one line in `schema.prisma`).
- **Auth**: email + password, `bcryptjs`, JWT in an httpOnly cookie. Not yet implemented (Step 2).
- **Real-time sync**: raw `ws` WebSocket server, server-authoritative snapshot broadcast (extends the
  drift-free `(remainingSeconds, updatedAt)` technique from the old `src/lib/store.ts`) — not Yjs/CRDT,
  since there's one authoritative writer per room. Not yet implemented (Step 4).
- **WebRTC**: mesh topology, signaling relayed over the same WS connection — no external SFU/LiveKit
  dependency. Not yet implemented (Step 5).
- **Document/quiz pipeline**: local disk upload (`server/uploads/`, gitignored) → in-process async worker
  → deterministic heuristic quiz generator (no LLM key available) → `quiz:ready` WS broadcast. Not yet
  implemented (Step 6).
- **Testing**: `vitest` + `supertest` in `server/`, one test gate per step.

## Steps

### Step 1 — Architecture & Setup — ✅ done

- `server/` scaffolded: `package.json`, `tsconfig.json`, `.env.example`/`.gitignore`.
- `server/prisma/schema.prisma`: `User`, `Room`, `Participant` (role: ADMIN/MEMBER), `PomodoroSession`
  (state: IDLE/POMODORO_ACTIVE/BREAK/QUIZ_PHASE), `Document`, `Quiz`, `QuizQuestion`, `QuizChoice`,
  `QuizAttempt`, `QuizResponse`. Migration `20260829143844_init` applied to `dev.db`.
- `server/src/db.ts` — Prisma client singleton.
- `server/src/app.ts` / `server/src/index.ts` — Express bootstrap, `GET /health`, listens on `PORT`
  (default 4000). Verified: dev server boots and `/health` returns `{status:"ok"}`.
- `server/src/lib/roomCode.ts` — ported the 5-char room-code generator from the old `src/lib/store.ts`.
- Tests: `tests/health.test.ts` (supertest), `tests/db.test.ts` (Prisma round-trip: User → Room →
  PomodoroSession, relations resolve). Both pass (`npm test` in `server/`).
- Known item to revisit: `multer@1.x` (needed in Step 6) has known high-severity advisories; upgrade to
  `multer@2.x` when wiring the upload endpoint if the 2.x API stabilizes cleanly with the rest of the stack.

### Step 2 — Auth & RBAC — ✅ done

- `server/src/lib/auth.ts` — bcryptjs password hashing, JWT sign/verify, httpOnly cookie options
  (`syncspace_token`, 7-day expiry, `sameSite: lax`, `secure` in production).
- `server/src/middleware/requireAuth.ts` — reads the cookie, verifies the JWT, loads the `User`, attaches
  `req.user`; 401 otherwise.
- `server/src/middleware/requireRoomRole.ts` — reads `req.params.roomId`, looks up the caller's
  `Participant` row, 403s if missing or if `role` isn't in the allowed set; attaches `req.participant`.
  Runs after `requireAuth`.
- `server/src/routes/auth.ts` — `POST /auth/register` (409 on duplicate email, zod-validated, 8-char
  password floor), `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`. Mounted at `/auth` in `app.ts`
  along with `cookie-parser`.
- Tests: `tests/auth.test.ts` (7 cases: validation, duplicate email, wrong password, login+/me round trip,
  unauthenticated /me, logout clears session) and `tests/rbac.test.ts` (4 cases: unauthenticated,
  admin allowed, member blocked from an admin-only route, non-participant blocked) — all passing.
  RBAC test seeds `Room`/`Participant` rows directly via Prisma since the Room API doesn't exist yet
  (Step 3); mounts a throwaway `requireAuth` + `requireRoomRole("ADMIN")` route to exercise the middleware
  in isolation.
- `npx tsc --noEmit` clean.

### Step 3 — Room management & FSM — ✅ done

- `server/src/lib/fsm.ts` — pure transition functions: `resolveSession` (drift-free replay of elapsed
  time, cycling `POMODORO_ACTIVE <-> BREAK` on expiry, never auto-entering `QUIZ_PHASE`/`IDLE`) and
  `applyAction` (`start`/`pause`/`resume`/`skip`/`endSession`/`reset`, each with an explicit legal-state
  check and the >=60s duration floor enforced on `start`).
- `server/src/routes/rooms.ts`:
  - `POST /rooms` — creates a Room + PomodoroSession (IDLE) + the creator as `ADMIN` participant.
  - `POST /rooms/:code/join` — idempotent rejoin; blocked with 403 unless `inviteEnabled` or caller is
    admin; 409 over capacity (default 10).
  - `GET /rooms/:roomId` — any participant; re-resolves and persists the live timer snapshot on read.
  - `PATCH /rooms/:roomId/invite` — admin-only invite toggle.
  - `DELETE /rooms/:roomId/participants/:userId` — admin-only removal; admin can't remove themselves.
  - `POST /rooms/:roomId/session` — admin-only FSM action endpoint, delegates to `fsm.ts`.
  - All room-scoped routes gated by `requireAuth` + `requireRoomRole`.
- Tests: `tests/fsm.test.ts` (14 unit tests on the pure transition table) and `tests/rooms.test.ts`
  (12 integration tests: create → invite-gated join → idempotent rejoin → RBAC blocks on read/session/
  removal → full FSM cycle including the 409 on re-starting from Quiz Phase and the 400 on a sub-minute
  duration → admin removes a participant). 39/39 tests passing repo-wide; `tsc --noEmit` clean.

### Step 4 — Real-time WebSocket engine — ✅ done

- `server/src/lib/roomView.ts` — extracted the shared `roomInclude`/`serializeRoom`/`resolveAndLoadRoom`
  helpers out of `routes/rooms.ts` so both the REST layer and the WS layer serialize rooms identically.
- `server/src/ws/registry.ts` — in-memory `Map<roomId, Set<WebSocket>>` connection registry
  (`addClient`/`removeClient`/`connectedRoomIds`/`sendToRoom`).
- `server/src/ws/index.ts`:
  - `attachWebSocketServer(httpServer)` — handles the raw `upgrade` event on the shared HTTP server
    (path `/ws?roomId=...`), authenticates via the same JWT cookie used by REST (parsed manually with the
    `cookie` package, since this runs outside Express's request cycle), and checks room membership before
    calling `wss.handleUpgrade` — rejects with a real HTTP 401/403 rather than accepting then closing.
  - `broadcastRoomUpdate(roomId)` — resolves the live timer snapshot (persisting on phase-boundary
    crossings, reusing `resolveAndLoadRoom`) and pushes `{ type: "room:update", room }` to every socket in
    that room.
  - A tick loop (`WS_TICK_MS`, default 1000ms) calls `broadcastRoomUpdate` for every room with connected
    clients, so a running timer counts down for everyone without any client-side polling.
  - `routes/rooms.ts` now calls `broadcastRoomUpdate` after every mutation (join, invite toggle,
    participant removal, session action) so REST-driven changes fan out over WS immediately, not just on
    the next tick.
  - `src/index.ts` now builds an explicit `http.Server` (`http.createServer(app)`) so Express and the WS
    upgrade handler share one port.
- Tests: `tests/ws.test.ts` — rejects a connection without a valid cookie (real 401 on the upgrade, not an
  accept-then-close), two concurrently connected clients both receive the initial snapshot and then both
  receive the updated snapshot after a REST session-start call, and a third test (tick interval shortened
  to 50ms via `WS_TICK_MS` in `tests/setup.ts`) confirms `remainingSeconds` decreases across two tick
  broadcasts with no REST call in between. 42/42 tests passing repo-wide; `tsc --noEmit` clean; verified
  the dev server boots with the WS engine attached and `/health` still responds.

### Step 5 — WebRTC integration — ✅ done (backend signaling only, see scope note)

Scoped down from the original roadmap line: the existing frontend (`src/app`, `RoomView`, `useRoom`)
still talks entirely to the old anonymous in-memory system — none of Steps 2-4 touched it. Rather than
silently doing a large frontend migration (auth pages, new room flow) as a side effect of "add WebRTC",
asked and confirmed: build and test the signaling relay server-side, and ship the WebRTC hook/components
as reusable but **not yet mounted into any page**. Wiring them into a live, authenticated room flow is
deferred to an explicitly-scoped pass.

- `server/src/ws/registry.ts` — added `sendToUser` (targeted delivery to one participant's socket(s)) and
  `onlineUserIds` (dedup'd list of connected user ids in a room).
- `server/src/ws/index.ts`:
  - On connect: sends `presence:sync` (current online user ids) directly to the new socket, then
    broadcasts `presence:joined`/`presence:left` to the room on connect/disconnect.
  - Relays `webrtc:offer` / `webrtc:answer` / `webrtc:ice-candidate` client messages to the named target
    user via `sendToUser`, tagging the relayed message with `from`; the server never inspects SDP/ICE
    contents, just routes them.
- `server/src/routes/rooms.ts` — `PATCH /rooms/:roomId/media` persists a participant's own
  `cameraOn`/`micOn` and broadcasts the update, so toggling camera/mic is visible to everyone on reload,
  not just live over WebRTC.
- Tests: extended `tests/ws.test.ts` (now 7 tests) — connection rejected for a non-participant,
  presence:joined/left fire correctly, signaling relay reaches only the targeted peer (not a bystander),
  and the media-toggle REST call round-trips through a broadcast. Caught and fixed one real bug this way:
  the join route takes the room's `code`, not its `id` - the test initially used the wrong one and got a
  404, which is exactly the kind of mismatch this test is meant to catch. 46/46 tests passing; `tsc
  --noEmit` clean in `server/`.
- Frontend (unmounted, not yet reachable from any page):
  - `src/lib/serverConfig.ts` — base URL helpers for the new backend + a `patchRoomMedia` fetch helper.
  - `src/hooks/useWebRTC.ts` — mesh WebRTC over the same signaling WS: the newly-joined peer offers to
    everyone already online (from `presence:sync`), already-present peers only answer, so each pair
    negotiates exactly once with no glare. Manages local `getUserMedia`, a `Map<userId, RTCPeerConnection>`,
    and camera/mic toggles (local track mute + `patchRoomMedia`). STUN-only (`stun:stun.l.google.com:19302`)
    - no TURN server/credentials available in this environment, so peers behind symmetric NATs may fail
    to connect; worth revisiting if that turns out to matter.
  - `src/components/room/VideoTile.tsx`, `VideoGrid.tsx`, `MediaControls.tsx` — unstyled functional
    components built on the hook.
  - Fixed root `tsconfig.json` to `exclude: ["node_modules", "server"]` — its `**/*.ts` include was
    sweeping the independent `server/` TypeScript project into the Next.js app's typecheck (and would
    have done the same during `next build`).
  - Known follow-up: the new backend's auth cookie is `sameSite: "lax"`, and the frontend (`:3000`) and
    backend (`:4000`) are different origins in dev. Lax cookies aren't sent on cross-site `fetch`/WebSocket
    upgrade calls initiated from a page (only on top-level navigations), so the REST/WS calls from these
    hooks may not actually carry the auth cookie once wired into a real page. Needs a decision when the
    frontend migration happens: a dev proxy so both are same-origin, or token-based WS auth instead of the
    cookie.

### Step 6 — Document upload & async quiz pipeline — not started
