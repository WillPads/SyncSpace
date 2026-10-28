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
  - ~~Known follow-up: `sameSite: "lax"` cookie across `:3000` / `:4000`.~~ Resolved in the frontend
    migration below. Correction to the original note: `SameSite` is about *site* (scheme + registrable
    domain), not origin, so `localhost:3000` → `localhost:4000` was never cross-site and Lax cookies would
    have been sent. The real friction was CORS plus the cookie living on the API host. Both went away by
    proxying `/backend/*` (REST and the WebSocket upgrade) through Next.js.

### Step 6 — Document upload & async quiz pipeline — ✅ done

Kept to the same backend-only scope as Step 5, for the same reason: no live page to mount an upload UI
onto yet. The REST API is fully built and tested end-to-end (upload -> async parse -> quiz generation ->
list -> take -> score); an upload form is frontend-migration work, deferred with the rest.

- `server/prisma/schema.prisma` — added `Document.storagePath` (the on-disk filename multer generates,
  separate from the user-facing original `filename`). Migration `20260829162952_add_document_storage_path`.
- `server/src/lib/quizgen.ts` — dependency-free heuristic quiz generator (no LLM key available in this
  environment): splits text into sentences, spreads up to 5 questions evenly across the document, blanks
  out each sentence's most salient word (longest non-stopword) as a cloze question, and draws 3 multiple-
  choice distractors from salient words found elsewhere in the document. Skips a candidate sentence if it
  can't find enough distinct distractors rather than producing a degenerate question.
- `server/src/lib/pipelineQueue.ts` — a simple in-process FIFO job queue (no Redis/BullMQ available
  without Docker); `enqueue(job)` runs jobs sequentially in the background, request handlers never block
  on parsing.
- `server/src/lib/documentPipeline.ts` — `processDocument(id)`: marks the `Document` `PARSING`, extracts
  text (`pdf-parse` for PDF, raw UTF-8 read for txt/md, from `server/uploads/`), marks it `READY` with the
  parsed text, runs `generateQuiz`, persists `Quiz`/`QuizQuestion`/`QuizChoice` rows if any questions came
  out, and broadcasts `{ type: "quiz:ready", documentId, quizId }` over the room's WS. Marks `FAILED` on
  any error rather than leaving the document stuck `PARSING`.
- `server/src/routes/documents.ts` — `POST /rooms/:roomId/documents` (multer disk storage, 10MB cap,
  restricted to .txt/.md/.pdf by mimetype or extension, any participant can upload) enqueues processing
  and returns immediately with status `PENDING`; `GET /rooms/:roomId/documents` lists them.
- `server/src/routes/quizzes.ts` — `GET /rooms/:roomId/quizzes` (list), `GET .../quizzes/:quizId` (full
  question/choice text, `isCorrect` deliberately omitted so taking the quiz isn't trivial), `POST
  .../quizzes/:quizId/attempts` (scores the submitted responses server-side against `QuizChoice.isCorrect`,
  persists a `QuizAttempt`/`QuizResponse`, and returns the score plus the correct choice ids so the client
  can reveal answers after submission).
- Tests: `tests/quizgen.test.ts` (4 unit tests on the heuristic itself) and `tests/documents.test.ts`
  (5 tests: rejects an unsupported file type, uploads a fixture and polls until the async pipeline reaches
  `READY` with a generated quiz attached, quiz questions don't leak `isCorrect`, and a perfect-vs-all-wrong
  attempt scores `total`/`0` respectively). 55/55 tests passing repo-wide; `tsc --noEmit` clean; verified
  the dev server boots and creates `server/uploads/` on startup.
- Minor known item: test-run uploaded files aren't deleted from `server/uploads/` afterward (the dir is
  gitignored, so this doesn't affect the repo - just local disk clutter over many runs).

**All 6 steps of the original template are now implemented on the backend.** What's deliberately not
done: the frontend still runs on the old anonymous in-memory system end-to-end (Steps 5 and 6 both
produced backend APIs plus, for WebRTC, unmounted reusable components) - migrating real pages onto the
new backend (auth, room creation/join, RBAC-gated controls, video grid, upload/quiz UI, and resolving the
cross-origin cookie question noted in Step 5) is its own scoped pass, not yet started.

## Frontend migration + redesign — ✅ done

Adopted the Claude Design mockup (`src/syncspace-frontend.zip`: a plain HTML/CSS/JS prototype of Overview,
Sign in, Dashboard and Room) and moved the frontend off the old anonymous in-memory API onto `server/`.
Asked and confirmed up front: migrate to the new backend in the same pass, and use the mockup's own CSS
rather than re-expressing it in Tailwind.

- **Styling:** vendored the mockup's `industry.css`, `theme.css` (Forest dark / Mist light) and `app.css`
  into `src/styles/`; `additions.css` covers what the mockup didn't draw (quiz phase, session notes,
  notices, empty states) and one real conflict: the mockup's `a:hover` colour outranks `.btn`, which would
  have turned primary `<Link>` buttons green-on-green on hover. Fonts via `next/font` (Barlow / Barlow
  Condensed); theme picked before first paint by an inline script, toggle persists `syncspace.mode`.
  **Removed Tailwind** (`tailwindcss`, `@tailwindcss/postcss`, `postcss.config.mjs`). No new packages.
- **Transport:** `next.config.ts` rewrites `/backend/*` to the server. Verified that Next proxies the
  WebSocket upgrade too (both `next dev` and `next start`), so every browser call is same-origin.
- **Screens:** `/` overview, `/login` (sign in + create account), `/dashboard` (your rooms with live clocks,
  real stats, join by code, New room dialog), `/join/[code]` (invite links), `/room/[id]` (Ring / Grid /
  Timeline views, people with live presence, host controls, invite toggle, remove / leave, tasks checklist,
  session notes upload, ambient sound, and a quiz panel in `QUIZ_PHASE`).
- **Data:** `lib/api.ts` (typed client), `hooks/useSession.ts` (SWR), `hooks/useLiveRoom.ts` (REST snapshot +
  WebSocket with backoff; a 403 on reconnect is how a removed member finds out), `lib/timer.ts` (derives
  the clock/rounds/segments; counts down from snapshot *receipt* time so device clock skew can't shift it).
- **Mockup vs. reality:** the server has no long break, so a "set" is four focus/break pairs and rounds wrap.
  Placeholder content was replaced with true content (overview card labelled "Preview", login panel explains
  how rooms work, step 03 describes the quiz instead of chat). Not built, no server support: chat, focus
  stats/streaks, scheduled sessions/RSVP, demo account, password reset.
- **Server additions:** `GET /rooms` (rooms you belong to), `inviteEnabled` on create, `Participant.task` +
  `PATCH /rooms/:roomId/task` (migration `add_participant_task`), members can remove themselves (leave).
  Two WebSocket fixes found while building the client: a removed participant's socket is now closed (it
  kept receiving room updates), and `presence:left` only fires when someone's *last* tab closes.
- **Removed:** the old in-memory API (`src/app/api/rooms/**`, `lib/store.ts`, `identity.ts`, `api-client.ts`,
  `http.ts`, `time.ts`, `hooks/useRoom.ts`) and the Tailwind components it used.
- **Verified:** server 63/63 tests (new `room-membership.test.ts`, extra WS cases); frontend `tsc`, `eslint`
  and `next build` clean; a 20-check end-to-end script through the proxy (register → create → join → live
  WS sync and ticking → RBAC 403 → shared task → leave closes the socket → presence:left → every page
  renders) passes under both `next start` and `next dev`. **Not verified visually**: no browser was
  available in this session, so layout, theming and hydration haven't been eyeballed.
- Still unmounted: the Step 5 WebRTC hook/components (now pointed at the proxy). The Grid view's tile face
  is the natural slot for video.

### Step 7 — Backend completion & audit fixes (2026-10-22) — ✅ done

Driven by the backend audit (`docs/backend-audit-2026-10-22.md`); backend only, the frontend is untouched
and its API contract is unchanged (every change is additive or a stricter rule the UI already follows).

- **Database:** SQLite migrations archived; Postgres-only history (`20261017000000_init` + new
  `20261022090000_server_sessions_and_integrity`, generated by Prisma from the migration history, which also
  adds the `QuizAttempt -> Quiz` foreign key the hand-written init had missed). Every relation now has a
  foreign key with cascade deletes, every foreign key column is indexed, `QuizResponse` is unique per
  (attempt, question), participants/choices have explicit ordering (Postgres row order isn't stable).
  `directUrl` added for Prisma Migrate on Neon. Verified: migrations apply to a fresh Postgres 17 with no drift.
- **Auth:** JWTs replaced by server-side sessions (`Session` table, SHA-256-hashed random tokens, sliding
  7-day expiry, rotation on login, `POST /auth/logout-all`). WebSocket tickets are single-use rows that
  die with their session. Logout closes that session's sockets immediately (close code 4001).
- **Errors:** Express 5 (async errors reach the error handler instead of crashing the process), one JSON
  error shape `{ error, code }` everywhere, Prisma errors mapped (409 / 404 / 503), JSON 404, fail-fast env
  validation (`src/config.ts`), graceful shutdown, `unhandledRejection` logged instead of fatal.
- **Abuse limits:** per-account failed-login lockout, per-IP login/sign-up limits, per-user limits on room
  creation, joins (stops code guessing), uploads (caps LLM spend) and socket tickets. Room codes from a CSPRNG.
- **Rooms:** joins serialized with a row lock (10-person cap holds under 12 simultaneous joins), admin
  removal bans (lift with `DELETE /rooms/:roomId/bans/:userId`), `DELETE /rooms/:roomId`, durations
  capped at 4 h. Timer writes use a `version` column (optimistic concurrency), so concurrent host actions
  can't both apply and the old tick-vs-reset lost update is gone.
- **Real-time:** timer resolved in O(1) from the stored snapshot (the old capped loop could leave a negative
  timer after ~1000 phase changes) and never written back on ticks; 1 s sync pulses served from an
  in-memory snapshot (no DB query per tick); `serverTime`/`endsAt`/`version` in snapshots; `hello` frame and
  `time:ping`/`time:pong` for clock sync; 64 KB frame cap, per-socket message budget, 30 s heartbeats, Origin
  check on cookie auth, zod-validated client frames, `webrtc:peer-unavailable`, media flags cleared once
  someone has been disconnected for 5 s (a grace period, so a page refresh can't race a fresh toggle),
  `room:deleted`, slow-consumer protection. Typed protocol in `src/ws/protocol.ts`.
- **Documents & quizzes:** **pdf-parse replaced by unpdf** (PDF.js 6) after finding that pdf-parse 1.x
  returned empty text for every PDF after the first one in a process. Uploads are checked by their bytes
  (PDF signature, no binary in text, UTF-16 supported), names kept in UTF-8, text sanitized for Postgres
  (NUL bytes), files deleted after parsing, `document:update` events, `failureReason`, boot-time recovery
  of interrupted jobs, two-job concurrency. Quizzes are written by Claude (`claude-opus-5-5`, structured
  JSON output, server-side refusal fallback, 90 s timeout, 2 retries) when `ANTHROPIC_API_KEY` is set, with
  the heuristic generator as the fallback for any failure; `Quiz.generatedBy` records which. Attempts only
  in `QUIZ_PHASE`, every question exactly once, choices must belong to their question (the old endpoint
  scored 5/2 for five copies of one right answer). New `GET .../quizzes/:quizId/results`.
- **Dependencies:** `npm audit` clean (prod and dev) for both packages. Server: Express 5.2 (body-parser
  2.4), multer 2.5, zod 4.6, Vitest 4.1.12, deepmerge-ts override for Prisma's config loader; Prisma
  pinned to 6.19.3 for CLI/client parity; Node 22+. Web app: Next.js 15.5.28 (fixes the critical RCE
  advisories below 15.5.28; no code changes), plus a PostCSS 8.5.30 override for Next's pinned copy,
  verified to produce byte-identical CSS.
- **Local development:** `npm run db:dev` runs a persistent local Postgres (`server/.dev-db/`) and
  `.env.example` points at it, so local work never touches the production database. Render's service
  is named `syncspace-willpads-api` (`syncspace-api.onrender.com` belongs to someone else), which fixes
  the backend URL at `https://syncspace-willpads-api.onrender.com`.
- **Tests:** `npm test` now runs on an embedded Postgres 17 (`embedded-postgres`, data in `server/.test-db/`)
  and never reads `server/.env`. 156 tests across 18 files (was 63): sessions, error handling, rate limits,
  bans/deletion/concurrency, the capacity race, quiz integrity, the pipeline with real PDFs and a fake LLM,
  LLM response parsing, and a realtime protocol suite (tickets, origin, heartbeats, floods, revocation).
  The WebSocket tests wait on conditions instead of fixed sleeps. Passed 3 runs in a row; `tsc` clean for
  `src/` and `tests/`. A production smoke run of the built server (`npm start` with
  `NODE_ENV=production` against fresh Postgres) passed 19/19, and a full-stack run of the built web app
  (`next start`) against the built server, with every call through the `/backend` rewrite (pages, cookie
  through the proxy, WebSocket through the proxy, uploads, quiz, kick, logout), passed 27/27.
- **Terminal client:** `npm run cli` (`server/scripts/cli.mjs`) is a menu-driven client for the whole API,
  so the backend can be used end to end without the web app. Verified with a scripted two-person session
  (20 checks: accounts, room, timer, task, upload -> quiz, live view, quiz, results, remove/ban/unban,
  leave, delete, clean quit).
- **Decisions:** no CRDT - every piece of shared state has one authoritative writer (the server) and the
  timer is a state machine whose transitions must be rejected, not merged; versioned server writes are the
  conflict resolution. Mesh WebRTC signaling kept (fine for 10 people); an SFU is out of scope.
  `inviteEnabled` keeps its name because the web app reads it. Full API reference: `server/API.md`.

### Step 8 — New design + Phase 3 features (2026-10-28) — ✅ done locally (not deployed)

Followed `docs/INTEGRATION.md`: the design in `docs/design/` (mockup, tokens, logo) replaces the Industry
look, and the features the mockup showed that the server lacked were built server-first with tests. Will
lifted the feature freeze for local building only; nothing was pushed or deployed.

- **Phase 1 (tokens, fonts, logo):** `src/styles/tokens.css` holds the brand palette, spacing and radii;
  `theme.css` maps the existing colour variables onto it for dark and light mode, so components picked up
  the new colours without edits. Barlow → Space Grotesk, with JetBrains Mono only for timer digits and room
  codes. New logo mark as an inline SVG coloured through `--logo-*` variables; `src/app/icon.svg` favicon.
  The mockup's `--shadow-glow` token was left out (no-glow rule).
- **Phase 2 (screens):** login, overview, dashboard, room (Ring/Grid/Timeline, quiz), `/join` restyled to
  the 12-column bento layout, markup and CSS only. Shared pieces live in `src/styles/base.css`, scoped under
  `.redesign` so screens could move over one at a time; one CSS file per screen in `src/styles/screens/`.
  Marketing copy was checked against the code and corrected (no video, no long break, no room types, no
  flashcards). Old Industry rules that nothing uses any more were deleted afterwards.
- **Phase 3 schema (4 migrations):** `user_admin_handoff` (a room's admin can't be deleted out from under
  it: `Room.admin` is now `RESTRICT`; a deleted user's uploads stay with `uploadedById` set to null;
  `Document.sizeBytes`), `chat_messages`, `scheduled_sessions`, `notepad_and_quick_notes` (5 notepad slots
  per user enforced by a unique index plus a hand-written `CHECK (slot BETWEEN 0 AND 4)`). Verified to apply
  cleanly on a fresh database and on one with existing rows, with no drift.
- **Phase 3 API:** settings (`PATCH /auth/me`, change password, which signs out other devices, and delete
  account, which hands hosted rooms to the longest-standing member or deletes empty ones, in one locked
  transaction), private notes and quick note (`/me/notes`, `/me/quick-note`), recent files across your rooms
  with a `canDelete` flag (`/me/documents`) and document delete, room scheduling (hosts only, max 20 upcoming,
  `GET /schedule/upcoming`), and room chat (REST writes, `chat:message` / `chat:deleted` over the WebSocket,
  stable cursor paging, newest 500 kept per room). Wrong passwords on signed-in routes are 403, never 401,
  so the UI never signs someone out for a typo.
- **Rate limits behind the proxy:** web traffic reaches the server through Vercel, so every visitor looked
  like the same IP. Sign-in and sign-up limits now key on the real client taken from `X-Forwarded-For` next
  to the address Render's edge reports in `CF-Connecting-IP` (`CLIENT_IP_HEADER`), with a looser per-edge
  ceiling so a faked header can't dodge them. Still to check once deployed: what headers actually arrive.
- **Phase 3 UI:** dashboard notepad, debounced quick-note autosave, uploads into a chosen room with
  client-side type/size checks, recent files that poll only while something is processing, upcoming sessions
  in local time with a host-only schedule dialog; room chat tile (dedupe by id, refetch on reconnect,
  "Load earlier", screen-reader announcements); `/settings` (profile, password, appearance, delete account)
  and `/signed-out`. Theme and background animation are stored in the browser, not the database.
- **Decisions (Will):** dashboard uploads go into a room you pick (no personal files); a deleted account's
  messages and uploads stay in the group's rooms as "Deleted user"; only hosts schedule; no practice quizzes
  outside the quiz phase. Left out rather than faked: bio, avatar upload, device settings, notifications,
  Pomodoro defaults, reminders, room types, forgot password, DOC/DOCX/image uploads.
- **Verified:** server 234 tests across 24 files on embedded Postgres, `tsc` clean for `src/` and `tests/`;
  web app `npm run lint` (0 errors), `tsc` and `next build` clean; every screen exercised against a real
  local stack (throwaway Postgres + API + `next start`) in dark and light mode at 390, 768 and 1280 px, with
  44 px tap targets, visible keyboard focus and WCAG AA contrast checked.
