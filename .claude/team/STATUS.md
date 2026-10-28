# Team status: SyncSpace

Last updated: 2026-10-28 (evening)

## Goal

Redesign (docs/INTEGRATION.md) Phases 1–3 built locally, then Phase 0 deploy (Vercel + Render + Neon) on Will's go-ahead.

## Board

| Task | Owner | Status | Notes |
|---|---|---|---|
| Backend (Steps 1–7, audit fixes) | backend | Done | Pushed to `main` at c77c854 |
| Terminal client `npm run cli` | backend | Done, uncommitted | `server/scripts/cli.mjs` + README/progress/package.json edits |
| Pre-deploy check (read-only) | backend + uiux | Done 2026-10-27 | Lead re-ran tests + build |
| Per-IP rate-limit fix behind Vercel→Render (CLIENT_IP_HEADER) | backend | Done, verified by Lead (uncommitted) | 162/162 tests, tsc 0. Needs a post-deploy header check |
| Phase 1: tokens, fonts, logo, favicon | uiux | Done, verified by Lead (uncommitted) | lint 0 errors, tsc 0, build ok, no Barlow/gradients |
| Phase 2: login (incl. copy fix) | uiux | Done, verified by Lead (uncommitted) | False claims removed; logic unchanged |
| Phase 2: dashboard | uiux | Done, verified by Lead (uncommitted) | Phase 3 tiles left out (not faked); shared AppBackdrop |
| Phase 2: room (+ /join) | uiux | Done, verified by Lead (uncommitted) | build ok, no hook/api lines changed, video still unmounted; chat slot = end of .rm-main |
| Phase 3 UI: dashboard notes, quick note, files + room picker, upcoming | uiux | Done, verified by Lead (uncommitted) | build ok, api.ts append-only; Delete shown on every file until canDelete lands |
| `/me/documents`: add uploadedById + canDelete | backend | Done, verified by Lead (uncommitted) | 234/234 tests, tsc 0; folds into "dashboard files" commit. uiux hides Delete where false (settings round) |
| Phase 3 UI: room chat | uiux | Done, verified by Lead (uncommitted) | useLiveRoom diff reviewed (additive subscribe only); no innerHTML; build ok |
| Phase 2+3: settings + /signed-out + overview + polish | uiux | Done, verified by Lead (uncommitted) | build ok; /settings, /signed-out routes |
| Cleanup: dead CSS, Corners.tsx, /login?mode=register, serverConfig comment, delete favicon.ico | uiux | Edits done (build ok); screenshot comparison + favicon in progress | Interrupted by session end, relaunched |
| Docs: README, progress.md (Step 8), HANDOFF (state + resume claims) | Lead | Drafted, awaiting Will's review | Will approved updating all three |
| Commits: 7 by area + CLAUDE.md/docs | Will | Ready: Will runs them himself (script from Lead) | Lead re-verified 2026-10-28 evening: 234/234 tests, tsc 0, build ok |
| Phase 3 contract | Lead | Agreed 2026-10-28 | See Contracts below |
| Phase 3 schema + migrations | data | Done, verified by Lead (uncommitted) | 4 migrations; delete rules + CHECK confirmed in SQL; tsc 0; 162/162 tests (3 files fail only in teardown, expected) |
| Phase 3 API + tests | backend | Done, verified by Lead (uncommitted) | 24 files / 232 tests, tsc 0; API.md updated; 7 commits proposed |
| Account deletion: keep in-flight uploads in surviving rooms | backend | Done, verified by Lead | settings tests 22/22, tsc 0; folds into commit 2 |
| Phase 3 UI (settings, notes, quick notes, files, schedule, chat) | uiux | After dashboard restyle | Shapes in backend report / server/API.md |
| Will's local dev DB: apply the 4 Phase 3 migrations | Will | Done 2026-10-28 | Lead confirmed `prisma migrate status`: 6 found, up to date (127.0.0.1:5433) |
| Phase 3 UI | uiux | After backend + Phase 2 | |
| Phase 0 deploy | Will + Lead | Go-ahead given 2026-10-28; Will doing dashboard steps | Order: Vercel env → commit + push → Render blueprint (Neon URLs) → Lead live checks |

## Deploy checklist

Blockers:
- Render: `DATABASE_URL` (Neon pooled), `DIRECT_URL` (Neon direct), `CLIENT_ORIGIN=https://sync-space-taupe.vercel.app` (defaults to localhost silently)
- Vercel: `SERVER_URL=https://syncspace-willpads-api.onrender.com`, `NEXT_PUBLIC_WS_URL=wss://syncspace-willpads-api.onrender.com`; baked in at build, so redeploy after setting
- Render service not created yet
- Phase 3 migrations must run on Neon via `prisma migrate deploy` (runs on Render boot); needs Will's OK
Should fix:
- After deploy: check `CF-Connecting-IP` / `X-Forwarded-For` arrive as backend expects (see backend Part A report)
- Render free tier sleeps after ~15 min: keep-alive ping or paid plan
- Confirm `claude-opus-5-5` model id before setting `ANTHROPIC_API_KEY`
- Uploads near 4 MB may hit Vercel's 4.5 MB cap with an unfriendly error
Nice to have: `serverConfig.ts` comment names the wrong Render host; README vs comment disagree on ticket TTL (30 s is right); `engines` field; orphan local `postgres.exe` (PID 10800)

## Decisions

- 2026-10-26: Server-side DB sessions replace JWT; Postgres (Neon) replaces SQLite
- 2026-10-26: No CRDT; server is the single authoritative writer
- 2026-10-27: No push/deploy until backend + frontend are final (a push to `main` redeploys Vercel)
- 2026-10-28: Phase 1 allowed during freeze; fonts → Space Grotesk + JetBrains Mono (Will)
- 2026-10-28: Feature freeze lifted for LOCAL building of Phase 3; no push/deploy (Will)
- 2026-10-28: Rate limits key on real client via `CLIENT_IP_HEADER=CF-Connecting-IP` + per-edge ceiling, not TRUST_PROXY=2 (spoofable on direct calls)
- 2026-10-28 (Will): dashboard uploads pick a room (no personal files); deleted accounts leave group content behind as "Deleted user"; only room admins schedule; NO practice mode, quizzes stay in QUIZ_PHASE
- 2026-10-28 (Lead defaults): bio = coming soon; chat keeps newest 500/room; joiners see history; email change needs password only; theme in localStorage
- 2026-10-28 (Lead): account deletion leaves the user's in-flight uploads in surviving rooms for the pipeline; only deleted rooms' files are removed
- 2026-10-28 (backend, accepted): deletion and name changes push `room:update` to all of the user's rooms; new 404 codes DOCUMENT/SCHEDULE/MESSAGE_NOT_FOUND, 400 INVALID_CURSOR
- 2026-10-28 (Will): Will makes and pushes commits himself (wants to be the GitHub contributor); push + deploy approved, incl. Phase 3 migrations on Neon
- 2026-10-28 (Will): ~7 commits by area; commit CLAUDE.md + docs/ (not STATUS.md, not Claude outputs/); delete favicon.ico; update README/progress/HANDOFF
- Standing: commits have NO Co-Authored-By / "Generated with Claude Code" lines; show message first, commit only when asked

## Blockers / needs Will

- Run the commit script, push, then the Render/Vercel/Neon dashboard steps
- Stray file `src/app/dashboard/settings.local.json` (`{"agent":"lead"}`): delete or move?
- Free Render + keep-alive, or paid plan
- Deploy credentials and go-ahead (see Deploy checklist)

## Contracts

Full API reference: `server/API.md`. Conventions: `requireAuth` on all, errors `{ error, code }`, ISO UTC timestamps, Vitest per route. Wrong password on a signed-in route = **403 `INVALID_PASSWORD`** (never 401, which signs the UI out). M = room member, A = room admin.

### Schema (data)

1. `user_admin_handoff`: `Room.admin` onDelete **Restrict** (was Cascade). `Document.uploadedById` nullable, onDelete **SetNull**. `Document.sizeBytes Int?`. `User.updatedAt`.
2. `chat_messages`: `ChatMessage { id uuid, roomId FK Cascade, authorId String? FK SetNull, body VarChar(500), createdAt }`; index `(roomId, createdAt desc, id desc)`, index `(authorId)`.
3. `scheduled_sessions`: `ScheduledSession { id, roomId FK Cascade, createdById String? FK SetNull, startsAt timestamptz, durationMin Int, createdAt, updatedAt }`; indexes `(roomId, startsAt)`, `(createdById)`. No title, no reminders table.
4. `notepad_and_quick_notes`: `NotepadItem { id, userId FK Cascade, slot Int, body VarChar(120), createdAt, updatedAt }`, `@@unique([userId, slot])` + hand-written `CHECK (slot BETWEEN 0 AND 4)`. `QuickNote { userId @id FK Cascade, body VarChar(5000) default "", updatedAt }`.
No bio, no practice flag, no personal (room-less) documents.

### API (backend)

Settings:
- `PATCH /auth/me` `{ displayName?: 1..40, email?, currentPassword? }` (password required if email changes) → `{ user }`; 400, 403 INVALID_PASSWORD, 409 EMAIL_TAKEN, 429 (10/h).
- `POST /auth/change-password` `{ currentPassword, newPassword }` → 204; revokes all OTHER sessions and closes their sockets; 400, 403, 429 (5/15 min).
- `POST /auth/delete-account` `{ password }` → 204 + clears cookie. One transaction: for each admined room (`FOR UPDATE`), promote the earliest-joined other member to ADMIN, or delete the room if empty; then delete the user. After commit: disconnect user everywhere, `room:update` for handed-over rooms, `room:deleted` for deleted ones. Their chat messages/documents/quizzes in rooms stay (author shown as "Deleted user"). 403, 429 (5/h).
- Appearance: client-only localStorage, no endpoint.

Chat:
- `GET /rooms/:roomId/messages?limit=1..100&before=<id>` (M) → `{ messages: ChatMessage[] oldest-first, nextBefore: string|null }`.
- `POST /rooms/:roomId/messages` `{ body: trimmed 1..500 }` (M) → 201 `{ message }`; 429 (10/10 s). Prune to newest 500 per room in the same transaction.
- `DELETE /rooms/:roomId/messages/:messageId` (author or A) → 204.
- `ChatMessage = { id, userId: string|null, displayName: string ("Deleted user" if null), body, createdAt }`.
- WS server→client: `chat:message { message }` (sender included; client dedupes by id), `chat:deleted { messageId }`. No client→server chat frames. Client refetches the latest page on `hello`.

Scheduling (A creates/edits/deletes, M reads):
- `POST /rooms/:roomId/schedule` `{ startsAt: future, ≤1 year out, durationMin: 15..240 }` → 201 `{ session }`; 409 if 20 upcoming already; 429 (30/h).
- `GET /rooms/:roomId/schedule` (M); `PATCH`/`DELETE /rooms/:roomId/schedule/:id` (A).
- `GET /schedule/upcoming?limit=10` (U) → `{ sessions: [{ id, roomId, roomName, startsAt, durationMin, createdById }] }`, where `startsAt + duration > now`, ascending.
- Lazily prune sessions that ended more than 7 days ago. No reminders.

Notes (private):
- `GET /me/notes` → `{ notes: [{ id, text, createdAt }] newest first, limit: 5 }`.
- `POST /me/notes` `{ text: 1..120 }` → 201; 409 NOTE_LIMIT_REACHED (lowest free slot; unique violation → 409).
- `DELETE /me/notes/:id` → 204 / 404.
- `GET /me/quick-note` → `{ text, updatedAt }`; `PUT /me/quick-note` `{ text: ≤5000 }` → same; last write wins; 429 (60/min).

Dashboard files:
- Upload uses the existing `POST /rooms/:roomId/documents` with a room picker in the UI (.pdf/.txt/.md, ≤4 MB); set `sizeBytes` at upload.
- `GET /me/documents?limit=6` → `{ documents: [{ id, filename, mimeType, sizeBytes, status, failureReason, createdAt, roomId, roomName, quizId|null, questionCount|null }] }` across the user's rooms, newest first. The dashboard polls every ~2 s while any item is PENDING/PARSING.
- `DELETE /rooms/:roomId/documents/:documentId` (uploader or A) → 204; cascades the quiz; WS `document:deleted { documentId }`.
- "Make quiz" on the dashboard = "Open in room" link (no practice mode).

### UI "coming soon" (never faked)

Bio, avatar upload, device pickers, notification switches, Pomodoro/quiz defaults, reminder bell, room types (Permanent/Temporary/Saved) + filters, DOC/DOCX/image uploads and "20 MB" (say 4 MB), forgot password, practice quizzes.
