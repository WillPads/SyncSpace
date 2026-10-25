# SyncSpace backend audit (2026-10-22)

Scope: everything under `server/` (Express 4 + Prisma 6/Postgres + `ws`), plus `render.yaml` and the `/backend` rewrite in `next.config.ts`. Every server source file was read. Checks run: `tsc --noEmit` (passes), `npm audit --omit=dev`, a test that `pdf-parse` loads under ESM (it does), and a review of the Postgres migration's indexes and foreign keys. **The test suite was not run**: `server/.env` still has a SQLite `DATABASE_URL`, so no Postgres was available.

The audit prompt cites `syncspace_core_requirements.md`, which isn't in the repo. Findings are measured against the code and the deployment plan. Section 0 lists where the prompt's spec and the actual system differ.

## Resolution (same day)

Every finding below has been fixed and covered by tests. The build log is in `progress.md` → Step 7, and the API reference is `server/API.md`.

**Verification:**

- 156 tests on real Postgres 17, passing 3 runs in a row.
- `tsc` is clean for `src/` and `tests/`.
- `npm audit` is clean for prod and dev dependencies, in both the server and the web app.
- A 19-check smoke run of the built server, started like Render starts it, passes.
- A 27-check full-stack run of the built web app against the built server, through the `/backend` rewrite, passes.

| Finding | Status |
| --- | --- |
| C1 async errors crash the server | Fixed: Express 5, JSON error handler, guarded WebSocket and background paths |
| C2 Prisma Migrate through a pooled URL | Fixed: `directUrl` / `DIRECT_URL` |
| C3 SQLite migrations | Fixed: moved to `C:\Dev\SyncSpace-archive` (the migration Prisma generated also adds a foreign key the hand-written init missed) |
| H1 tick vs. admin-action race | Fixed: ticks never write; timer writes are versioned |
| H2 quiz scoring | Fixed: one answer per question, choices checked, quiz phase only |
| H3 rate limiting | Fixed: per account, per user and per IP (see `TRUST_PROXY` in `server/API.md`) |
| H4 unbounded WebSocket frames | Fixed: 64 KB cap, per-socket message budget |
| H5 vulnerable dependencies | Fixed: 0 advisories |
| H6 capacity race | Fixed: row lock; tested with 12 simultaneous joins |
| M1 JWT revocation | Fixed: replaced by server-side sessions, as the spec requires |
| M2–M9 | Fixed: heartbeats, snapshot cache, foreign keys and indexes, NUL bytes, pipeline gaps, JSON errors, quiz phase, Origin check. One exception: PDF text extraction still runs on the main thread rather than a worker thread. It's capped at 100 pages and read one page at a time, so it yields between pages |
| LOW items | Fixed: fail-fast config, timing-equalized login, single-use 30 s tickets, media flags, graceful shutdown, `/health/ready`, bans, quiz distractors. Accepted as-is: `/register` still returns 409 for a taken email (UX trade-off); `Room.adminId` and `Participant.role` are both kept (always written together, and there's no admin transfer) |
| *Found while fixing:* pdf-parse 1.x returned empty text for every PDF after the first in a process | Fixed: replaced with unpdf (PDF.js 6) |
| *Found while fixing:* Postgres row order made participant lists reshuffle | Fixed: explicit ordering |

**Section 0 differences, decided:**

- Server-side sessions and Claude quiz generation are now implemented.
- CRDTs are not used. The server is the single authoritative writer, so versioned writes are the right conflict resolution for a state machine.
- Mesh WebRTC is kept, and no SFU was added.

---

## 0. Spec vs. reality (read first)

These aren't bugs. They're places where the audit prompt describes a different system from the one that existed at audit time. The Resolution section above records what was decided for each.

| Prompt says | What the code does | Recommendation |
| --- | --- | --- |
| Server-side session cookies in the DB, "no JWTs" | Stateless JWT in an httpOnly cookie (`syncspace_token`, 7 days) | At audit time: keep JWT until after deploy and close the revocation gap (M1) later. Superseded: server-side sessions were implemented. |
| CRDTs for conflict resolution | None. The server is authoritative, and the last write wins | Nothing in the app needs a CRDT: tasks are per-user and notes are uploads. Drop the claim. |
| Sync pulses keep drift ≤ 50 ms | A 1 s `room:update` tick. The client counts down from when it received the update (`src/lib/timer.ts`), so device clock skew doesn't matter, but nothing measures drift | Don't quote 50 ms unless you measure it. |
| LLM parsing in the quiz pipeline | A deterministic cloze generator (`server/src/lib/quizgen.ts`) with no LLM call | Describe it as "heuristic quiz generation". |
| WebRTC Full Mesh or SFU | Mesh signaling relay only. The video UI isn't mounted | Matches the project's current scope (signaling built, video UI not mounted). |
| Kick should invalidate the user's session | A kick removes room membership. REST access is re-checked on every request, and the user's sockets are closed (code 4003) | This is the right model. Logging someone out entirely for being kicked from one room would be wrong. |

---

## CRITICAL: blocks deployment

### C1. Any async error crashes the whole server

- **Where:** every `async` route handler, `requireAuth`, `requireRoomRole`, the WS upgrade handler (`server/src/ws/index.ts:40`), and the tick loop (`ws/index.ts:96`, `void broadcastRoomUpdate`).
- **Problem:** Express 4 doesn't catch rejected promises, and there's no error middleware. Node ≥ 15 exits the process on an unhandled rejection. Any Prisma error therefore kills the process and drops every room's WebSockets. Examples: a Neon connection blip, a cold-start timeout, or two concurrent sign-ups with the same email (P2002 on `User.email`). The tick loop queries the DB every second for every connected room, so with Neon this will happen in production.
- **Fix:**
  1. Wrap the handlers, or upgrade to Express 5, which forwards rejected promises to the error handler. Then add a final `app.use((err, req, res, next) => res.status(500).json({ error: "Something went wrong." }))`.
  2. Put `try/catch` around the upgrade handler body (respond 500 and destroy the socket) and around each tick's `broadcastRoomUpdate`.
  3. Map P2002 to 409 in `/auth/register` and `/rooms/:code/join`.
  4. Add a test where Prisma throws and the process survives.

### C2. Prisma Migrate through Neon's pooled URL

- **Where:** `server/prisma/schema.prisma:5`, `render.yaml`, the `start` script (`prisma migrate deploy`).
- **Problem:** `migrate deploy` runs on every boot. Neon's own Prisma guide uses a *direct* (non-pooled) connection for migrations and the pooled one for the app. The schema has only `url`, so you have to choose one. Correction to my earlier advice: don't just paste the pooled URL.
- **Fix:** add `directUrl = env("DIRECT_URL")` to the datasource. Set `DATABASE_URL` to the pooled Neon URL and `DIRECT_URL` to the direct one, both in `server/.env` and on Render (`sync: false`). Update `.env.example` and the README.

### C3. The old SQLite migrations are still in `prisma/migrations/`

- **Where:** `20260829143844_init`, `20260829162952_add_document_storage_path`, `20260928184305_add_participant_task`.
- **Problem:** they contain SQLite-only SQL (`PRAGMA …`). `migrate deploy` would run them before `20261017000000_init` and fail on Postgres.
- **Fix:** remove the SQLite migration folders so only the Postgres history remains.

---

## HIGH

### H1. Timer writes race with admin actions, and the DB is written every second

- **Where:** `server/src/lib/fsm.ts:30-46`, `server/src/lib/roomView.ts:34-43`, `server/src/routes/rooms.ts:164-191`.
- **Problem:** `resolveSession` returns a patch on every call while the timer runs, not only at phase boundaries (the docstring in `roomView.ts:33` is wrong). So the tick loop writes `{state, remainingSeconds, updatedAt, sessionsCompleted}` once a second per running room. That write races admin actions: if a `reset` or `endSession` commits between a tick's read and its write, the tick writes `state: POMODORO_ACTIVE` back over it. The admin's action is silently undone, and the FSM ends up in an invalid state (`POMODORO_ACTIVE`, not running, reset counters). Two overlapping `/session` requests have the same lost-update problem.
- **Fix:**
  1. Have the tick resolve in memory and broadcast, persisting only when the phase actually changes.
  2. Make every session write conditional (optimistic concurrency). Use `updateMany({ where: { roomId, updatedAt: snapshot.updatedAt }, data })` and retry or re-read when `count === 0`.
  3. Add a test that interleaves a tick write with `reset`.

### H2. Quiz scoring trusts the client's response list

- **Where:** `server/src/routes/quizzes.ts:54-95`.
- **Problem:**
  - Responses aren't deduplicated or checked against the quiz. Sending the correct answer for question 1 ten times scores 10 on a 5-question quiz.
  - `questionId` and `choiceId` values from other quizzes, or made-up strings, are stored in `QuizResponse`. Neither column has a foreign key (see M4).
  - Unlimited attempts, and each response reveals `correctChoices`, so a second attempt can always be perfect.
- **Fix:**
  - Reject requests where a `questionId` isn't in this quiz, a `choiceId` doesn't belong to its question, or a question appears twice. Return 400.
  - Optionally require exactly one response per question.
  - Decide on an attempts policy, e.g. one counted attempt per user per quiz (`@@unique([quizId, userId])`), or keep only the best score.

### H3. No rate limiting anywhere

- **Where:** `/auth/login`, `/auth/register`, `/rooms/:code/join`, document uploads.
- **Problem:**
  - Login can be brute-forced (bcrypt cost 10 only slows it down).
  - Room codes are 5 characters from a 32-character set (about 33M), and they're the only thing guarding a room with invites on, so a scripted join loop can find open rooms.
  - Uploads can fill the disk and the parsing queue.
  - **Trap:** `trust proxy` is `1`, but production traffic passes through Vercel's proxy and then Render's, so `req.ip` will probably be Vercel's egress IP for every user. Naive per-IP limits would then throttle everyone together. The comment at `server/src/app.ts:11` describes this wrongly.
- **Fix:**
  - Add `express-rate-limit`, keyed per account where possible (email for login, `req.user.id` for join and upload) and per IP as a backstop.
  - Once deployed, check what `req.ip` and `X-Forwarded-For` contain on Render, then set `trust proxy` to match.

### H4. WebSocket messages are unbounded

- **Where:** `server/src/ws/index.ts:37` (`new WebSocketServer({ noServer: true })`), `handleSignalingMessage`.
- **Problem:** `ws` defaults `maxPayload` to **100 MiB** (verified in `node_modules/ws/lib/websocket-server.js:74`). Any room member can send huge or rapid `webrtc:*` frames, which the server parses and relays to a peer. That's a memory and bandwidth denial of service from any authenticated user.
- **Fix:**
  - Set `maxPayload: 64 * 1024`.
  - Add a per-socket message budget, e.g. 50 messages/s, and close the socket with code 1008 when it's exceeded.
  - Validate `payload` size and shape before relaying.

### H5. Known vulnerabilities in dependencies

- **Where:** `npm audit --omit=dev` reports 7 (1 critical, 3 high, 3 moderate): `proxy-addr` (critical, IP spoofing via an IPv4-mapped IPv6 trust subnet), `deepmerge-ts`/`@prisma/config`/`prisma` (high), and `qs`/`body-parser`/`express` (moderate, DoS).
- **Impact:** the `proxy-addr` issue only applies to subnet-style `trust proxy` values. This app uses a hop count, so real exposure is low, but none of these should ship.
- **Fix:** `npm audit fix` (all non-major), then rerun tests. Also check whether `multer` 2.x should replace `1.4.5-lts.2`, since 2.0.x fixed several DoS advisories. npm audit didn't flag the installed version, so this isn't confirmed.

### H6. The 10-person capacity limit can be exceeded

- **Where:** `server/src/routes/rooms.ts:88-93`.
- **Problem:** the join route counts participants and inserts in separate steps with no transaction. Two joins arriving together at 9/10 both pass the check and the room ends up with 11. The same pattern sends concurrent joins by one user into a P2002 crash (C1).
- **Fix:** do the count and the insert in one `prisma.$transaction`. Inside it, lock the room row (`SELECT … FOR UPDATE` via `$queryRaw` with tagged parameters) or use Serializable isolation and retry on conflict. Add a concurrency test that fires 12 joins at once and expects exactly 10 members.

---

## MEDIUM

### M1. A JWT can't be revoked

- Logout only clears the cookie (`server/src/routes/auth.ts:73`). A copied token keeps working for 7 days. There's no password change or "log out everywhere".
- **Fix (after deploy):** cheapest is a `User.tokenVersion` column that's included in the JWT and compared in `requireAuth`. That check already loads the user, so it adds no extra query. Bump the version on logout-all or password change. Alternatively, the prompt's DB `Session` table, which is a larger change.

### M2. No WebSocket heartbeat

- **Problem:** there's no ping/pong. Half-open sockets (dropped mobile connections, sleeping laptops) stay in the registry until TCP gives up, which can take minutes. In that time they show as online in presence, receive ticks, and count as peers for WebRTC. `ws.on("error")` removes the client without broadcasting `presence:left`.
- **Fix:** use the standard `ws` heartbeat: ping every 30 s and `terminate()` any socket that didn't pong. Send `presence:left` on both close and error.

### M3. Tick loop load

- **Problem:** every second, every connected room runs a 3-query load (room, session, participants), and the writes from H1 come on top. Nothing stops ticks from overlapping when Neon is slow, so queries can pile up. The loop also keeps the Neon compute awake whenever anyone is connected, which uses up the free-tier compute allowance.
- **Fix:** add an in-flight guard per room. After H1, broadcast only on changes plus a slow heartbeat (e.g. every 10 s). The client already interpolates the countdown, so it doesn't need a 1 s tick.

### M4. Missing foreign keys and indexes

- **Missing relations:** `Quiz.roomId` has no relation to `Room`. `QuizAttempt.userId` has none to `User`. `QuizResponse.questionId` and `.choiceId` have none either. The database therefore accepts orphaned or forged rows.
- **Missing indexes:** Postgres doesn't index foreign key columns automatically. The only indexes are the four unique ones. Missing: `Participant.userId` (used by the dashboard query `GET /rooms`), `Document.roomId`, `Quiz.roomId`, `Quiz.documentId`, `QuizQuestion.quizId`, `QuizChoice.questionId`, `QuizAttempt.quizId`/`userId`, `QuizResponse.attemptId`.
- **No `onDelete` rules.** There are no delete endpoints yet, so this is latent.
- **Fix:** one new migration that adds the relations and `@@index`es. Choose `onDelete: Cascade` where it makes sense.

### M5. NUL bytes in extracted text fail on Postgres

- **Where:** `server/src/lib/documentPipeline.ts:33-34`.
- **Problem:** Postgres `text` rejects `\u0000`; SQLite accepted it. Some PDFs, and any binary file passed off as `.txt` (the file filter accepts a matching extension *or* a matching mimetype), will now fail with `FAILED`. This regression comes from the SQLite → Postgres switch.
- **Fix:** `text.replace(/\u0000/g, "")` before saving. Also require both extension *and* mimetype to match, and consider sniffing the `%PDF-` header.

### M6. Gaps in the document pipeline

- **Restarts:** the queue lives in memory (`server/src/lib/pipelineQueue.ts`). A restart mid-job (every Render deploy, every crash) leaves documents stuck in `PENDING` or `PARSING` forever.
- **Failures are silent:** only `quiz:ready` is broadcast. A `FAILED` document, or one that produced zero questions, sends no event, so clients have to poll.
- **Event loop blocking:** `pdf-parse` runs on the main thread, and a large PDF freezes every room's ticks and signaling while it parses.
- **Disk:** uploaded files are never deleted after parsing.
- **Fix:**
  - On boot, mark stale `PENDING`/`PARSING` documents as `FAILED`.
  - Broadcast `document:update` with the status for every transition.
  - Delete the file once its text is stored.
  - Move parsing to a `worker_thread` (post-deploy is fine).

### M7. Not every error response is JSON

- **Problem:** a malformed JSON body gets Express's default HTML 400 page, an unknown route gets an HTML 404, and an oversized upload returns 400 where 413 is correct. A native or mobile client can't parse these consistently.
- **Fix:** add a JSON 404 handler and a JSON error middleware (shared with C1) that maps `entity.parse.failed` → 400 and `LIMIT_FILE_SIZE` → 413. Optionally add a machine-readable `code` next to `error`.

### M8. The quiz phase isn't enforced

- **Problem:** quizzes can be taken in any room state, so `QUIZ_PHASE` exists in the FSM but doesn't gate anything.
- **Fix:** decide the rule. If quizzes belong to the quiz phase, have `POST …/attempts` return 409 unless `session.state === "QUIZ_PHASE"`. Otherwise document that quizzes are always available.

### M9. No Origin check on the WebSocket upgrade

- **Problem:** the cookie fallback path (`server/src/ws/index.ts:50-52`) accepts any `Origin`. In production the cookie lives on the Vercel domain and the socket uses a ticket, so exposure is small. The check is still cheap defence against cross-site WebSocket hijacking.
- **Fix:** reject upgrades whose `Origin` isn't `CLIENT_ORIGIN` (allowing a missing Origin for native clients).

---

## LOW

- **JWT_SECRET is only checked when first used.** `getJwtSecret()` throws per request rather than at startup, so a misconfigured server boots and then fails on every login. Validate env vars at startup (zod) and exit if they're invalid.
- **Account enumeration.** `/register` returns 409 for existing emails, and `/login` skips bcrypt when the user doesn't exist, which makes the response time different. Run bcrypt against a dummy hash for unknown emails. The 409 is a reasonable UX trade-off.
- **WS ticket.** It's reusable for its full 60 s and travels in the URL, so it can end up in proxy logs. Acceptable for now. Shorten it to around 20 s, or make it single-use with a `jti` stored in memory.
- **Stale media flags.** `cameraOn` and `micOn` are never reset on disconnect. Reset them when the user's last socket closes.
- **Two sources of truth for admin.** `Room.adminId` and `Participant.role` can drift apart. Pick one, or update both in the same transaction if admin transfer is ever added.
- **No graceful shutdown.** There's no SIGTERM handler. Close the HTTP and WS servers and call `prisma.$disconnect()` so Render deploys don't cut requests off mid-way.
- **`/health` doesn't touch the DB.** That's fine for Render's liveness check. Optionally add `/health/db` for debugging.
- **Kicked users can rejoin straight away** when invites are on (there's no ban list). This is a product decision; a ban list would be a new feature.
- **`quizgen` distractors are case-sensitive.** "Energy" and "energy" can both appear as choices. Deduplicate case-insensitively.

---

## Verified correct (keep doing this)

- Every request body goes through a zod schema before any DB write. There's no raw SQL (`$queryRaw`/`$executeRaw` don't appear), so Prisma parameterizes all queries and SQL injection isn't possible.
- RBAC is enforced on the server: `requireRoomRole` re-reads membership from the DB on every request. That makes a kick take effect on the next REST call, and `disconnectUser` closes the user's sockets right away.
- The WebSocket upgrade checks the ticket or cookie *and* room membership before accepting.
- WS tickets carry a separate audience, so `verifyAuthToken` refuses to treat a ticket as a session (covered by tests).
- The cookie is `httpOnly`, `SameSite=Lax`, and `Secure` in production. The `/backend` rewrite keeps it first-party, and Lax plus JSON-only bodies blocks CSRF on the REST API.
- Passwords are hashed with bcrypt and never returned. `publicUser` whitelists the fields it sends.
- `GET /quizzes/:id` never sends `isCorrect`.
- Upload membership is checked before multer writes anything, uploads get random names, and they aren't served statically, so an uploaded HTML file can't become stored XSS.
- `server/.env` is gitignored and has never been committed (checked all history). Render generates `JWT_SECRET` itself (`generateValue: true`).
- Payloads are portable across client platforms: JSON only, ISO dates, `{ error }` failures, and a `type` field on every WS message. Native apps can use the same API. For native mobile later, consider also accepting `Authorization: Bearer` alongside the cookie (that's a new feature, so after the freeze).

---

## Suggested order (at audit time)

1. **Required for deploy:** C3 (cleanup) → C2 (`directUrl`) → run the test suite on Neon → C1 (error handling) → H5 (`npm audit fix`).
2. **Before sharing the link:** H1 (timer race), H2 (quiz scoring), H3 (rate limits on login and join), H4 (`maxPayload`), M5 (NUL bytes). Each is small and comes with a test.
3. **After deploy:** H6, M1–M4, M6–M9, then the LOW items.

All of these are bug fixes or hardening, so they stay within the feature freeze. The exceptions are a DB session table (M1, alternative option) and Bearer auth, which are features and should wait.
