# SyncSpace

Co-working rooms that share one Pomodoro clock. Create a room, share the code, and everyone inside focuses and breaks together, with a live room chat. When the host ends the session, the room gets a quiz generated from the notes people uploaded. Your dashboard keeps a 5-line notepad, a quick note, your recent files and the sessions your rooms have scheduled.

## Stack

- **Frontend** (repo root): Next.js 15 (App Router) + TypeScript, built from the SyncSpace design mockup in [`docs/design/`](docs/design/): a flat bento-box layout with dark and light themes, set entirely in Space Grotesk (timers use same-width digits so they don't jitter). Plain CSS, no Tailwind. Data fetching uses SWR.
- **Backend** (`server/`): Node.js + Express 5 + Prisma on PostgreSQL, with a `ws` WebSocket server for live room state. Auth is email/password with server-side sessions stored in Postgres: the httpOnly cookie holds a random token and only its hash is stored. Quizzes are written by Claude when an Anthropic API key is set, with a built-in generator as the fallback. The full REST and WebSocket reference is [`server/API.md`](server/API.md); the build log is [`progress.md`](progress.md).

## Getting started

You need three terminals: a local database, the server, and the web app.

```bash
# 1. Database (Postgres on 127.0.0.1:5433; first run takes about 20 s)
cd server
npm install
npm run db:dev

# 2. Server (http://localhost:4000)
cd server
cp .env.example .env        # first time only; the defaults point at the db:dev database
npx prisma migrate deploy
npm run dev

# 3. Web app (http://localhost:3000)
npm install
npm run dev
```

Open http://localhost:3000, create an account, and open a room.

### Terminal client

The server can also be used without the web app, from a menu-driven terminal program (start the database and the server first, as above):

```bash
cd server
npm run cli
```

It covers everything the API does: accounts, rooms, the timer, tasks, uploading notes, quizzes, a live view of the room, removing and un-banning people. Run it in two terminals to be two people in one room. `SYNCSPACE_URL` points it at a different server (default `http://localhost:4000`).

Local development uses its own database, so experiments never touch production data: both URLs in `server/.env` point at the `db:dev` Postgres (`postgresql://postgres:postgres@127.0.0.1:5433/syncspace`). Any other Postgres works too; set both URLs to it. On Neon, `DATABASE_URL` is the pooled connection string and `DIRECT_URL` the direct one (Prisma Migrate needs a direct connection). Optionally set `ANTHROPIC_API_KEY` to have Claude write the quizzes.

The browser only ever talks to `localhost:3000`. A rewrite in [`next.config.ts`](next.config.ts) proxies `/backend/*` to the server. That keeps the auth cookie first-party and means there's no CORS to configure. Set `SERVER_URL` if the server isn't on `http://localhost:4000`.

## Deployment

| Part | Host | Config |
| --- | --- | --- |
| Database | Neon (Postgres) | — |
| API server (`server/`) | Render | [`render.yaml`](render.yaml) |
| Web app (repo root) | Vercel | environment variables below |

Vercel's proxy can't carry WebSocket upgrades, so in production the room socket connects straight to the server. The browser first asks `GET /auth/ws-ticket` (through the proxy, using the cookie) for a single-use ticket that expires in 30 seconds, then opens `wss://<server>/ws?roomId=…&ticket=…`.

**Render** (server): `DATABASE_URL` (Neon, pooled), `DIRECT_URL` (Neon, direct), `CLIENT_ORIGIN` (the Vercel URL), `NODE_ENV=production`, and optionally `ANTHROPIC_API_KEY`. `render.yaml` also sets `CLIENT_IP_HEADER=CF-Connecting-IP`, so sign-in and sign-up limits count each real visitor separately even though all web traffic reaches the server through Vercel. The start command runs `prisma migrate deploy` before booting. If an older Render service still has a `JWT_SECRET` variable, it's unused and can be deleted.

**Vercel** (web app): `SERVER_URL=https://syncspace-willpads-api.onrender.com` and `NEXT_PUBLIC_WS_URL=wss://syncspace-willpads-api.onrender.com` (the Render service name in `render.yaml` sets that URL). Both are required for Production: [`next.config.ts`](next.config.ts) fails the Vercel production build if either is missing or points at a private address such as localhost, because the values are baked in when the site is built.

On Render's free plan the server sleeps after 15 minutes without traffic, so the first request after a while can take up to a minute. Uploaded files are processed straight into the database, so Render's temporary disk is fine; uploads are capped at 4 MB to fit Vercel's request size limit.

## Screens

| Route | Screen |
| --- | --- |
| `/` | Welcome page: what SyncSpace is, with Create account and Sign in |
| `/login` | Sign in or create an account (`?mode=register` opens on Create account) |
| `/dashboard` | Your rooms with live clocks, join by code, New room dialog, plus a 5-line notepad, an auto-saving quick note, uploads into a room you pick, recent files, and upcoming sessions (hosts can schedule them) |
| `/join/<code>` | Where invite links land: joins the room, then opens it |
| `/room/<id>` | The shared room: Ring, Grid or Timeline view, people, live chat, your task list, session notes, ambient sound. Becomes the quiz once the host ends the session |
| `/settings` | Profile (name, email), password, appearance (theme, background animation), delete account |
| `/signed-out` | Where you land after signing out or deleting your account |

The host (the room's creator) starts, pauses, skips and ends the session, opens or closes invites, schedules sessions, and can remove people or delete any chat message. Someone the host removes can't rejoin until the host lifts the ban (`DELETE /rooms/:roomId/bans/:userId`; there's no button for it in the web app yet). Everyone else follows the clock. Rooms hold at most 10 people.

Deleting your account hands each room you host to the member who has been there longest (a room with nobody else in it is deleted). Your chat messages and uploads stay in those rooms, shown as "Deleted user".

## How sync works

The server owns the clock. Every room change is pushed over the room WebSocket as a full snapshot, and while people are connected the server re-sends it every second with the timer worked out from its own clock (no database query per tick). Snapshots carry `serverTime` and the phase's `endsAt`, and the socket answers `time:ping` frames, so a client can line its clock up with the server's; the current web client counts down from the moment it received the last snapshot. Timer writes are versioned, so two simultaneous host actions can't both apply. Presence (who's online vs. away) comes from who has the room open, with heartbeats dropping dead connections.

Chat is sent and deleted over REST; the room WebSocket only pushes `chat:message` / `chat:deleted` to everyone in the room. The client de-duplicates by message id (the sender gets its own message back too), and refetches the newest page whenever the socket reconnects, because the server doesn't replay frames missed while offline. Older messages load page by page with a cursor; each room keeps its newest 500.

## Styles

All plain CSS in `src/styles/`, loaded in this order by `src/app/layout.tsx`:

- `industry.css`: the base layer (reset, spacing and type scale) from the first mockup.
- `tokens.css`: the brand tokens from [`docs/design/tokens.css`](docs/design/tokens.css) (colours, spacing, radii, type).
- `theme.css`: maps the app's colour variables onto the brand palette for dark and light mode, plus the logo colours. The theme follows the OS until you pick one (app-bar button or Settings).
- `app.css`, `additions.css`: the few older rules still in use.
- `base.css`: shared pieces of the redesign (tiles, buttons, inputs, dialogs, app bar, page backdrop), all scoped under `.redesign`.
- `screens/*.css`: one file per screen (login, overview, dashboard, room, settings, signed-out).

Design rules: flat fills only. No gradients and no blurred shadows; tiles are separated by a 1px border. No glow on the logo. The welcome and sign-in pages have no decorative backdrop; the signed-in screens keep the flat SVG dot and ring backdrop.

## Not built yet

The mockup also shows these; there's no server support yet, so they're left out rather than faked: profile bio and avatar upload, audio/video device settings, notification settings, Pomodoro/quiz defaults, session reminders, room types (permanent/temporary/saved), forgot password, DOC/DOCX/image uploads, and focus stats. Video calling exists as a hook (`src/hooks/useWebRTC.ts`) with server-side signaling, but isn't mounted in the room yet.

## Scripts

- `npm run dev` / `npm run build` / `npm run lint`: web app
- `cd server && npm test`: server test suite (Vitest, 234 tests). It starts its own embedded Postgres in `server/.test-db/` (about 20 seconds the first time) and never reads `server/.env`; set `TEST_DATABASE_URL` to use another database instead.
