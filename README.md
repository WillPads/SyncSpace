# SyncSpace

Co-working rooms that share one Pomodoro clock. Create a room, share the code, and everyone inside focuses and breaks together. When the host ends the session, the room gets a quiz generated from the notes people uploaded.

## Stack

- **Frontend** (repo root): Next.js 15 (App Router) + TypeScript, styled with the Industry design system from the Claude Design mockup: Forest (dark) and Mist (light) themes, Barlow type, blueprint frames. Plain CSS, no Tailwind.
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

Local development uses its own database, so experiments never touch production data: both URLs in `server/.env` point at the `db:dev` Postgres (`postgresql://postgres:postgres@127.0.0.1:5433/syncspace`). Any other Postgres works too; set both URLs to it. On Neon, `DATABASE_URL` is the pooled connection string and `DIRECT_URL` the direct one (Prisma Migrate needs a direct connection). Optionally set `ANTHROPIC_API_KEY` to have Claude write the quizzes.

The browser only ever talks to `localhost:3000`. A rewrite in [`next.config.ts`](next.config.ts) proxies `/backend/*` to the server. That keeps the auth cookie first-party and means there's no CORS to configure. Set `SERVER_URL` if the server isn't on `http://localhost:4000`.

## Deployment

| Part | Host | Config |
| --- | --- | --- |
| Database | Neon (Postgres) | — |
| API server (`server/`) | Render | [`render.yaml`](render.yaml) |
| Web app (repo root) | Vercel | environment variables below |

Vercel's proxy can't carry WebSocket upgrades, so in production the room socket connects straight to the server. The browser first asks `GET /auth/ws-ticket` (through the proxy, using the cookie) for a single-use ticket that expires in 30 seconds, then opens `wss://<server>/ws?roomId=…&ticket=…`.

**Render** (server): `DATABASE_URL` (Neon, pooled), `DIRECT_URL` (Neon, direct), `CLIENT_ORIGIN` (the Vercel URL), `NODE_ENV=production`, and optionally `ANTHROPIC_API_KEY`. The start command runs `prisma migrate deploy` before booting. If an older Render service still has a `JWT_SECRET` variable, it's unused and can be deleted.

**Vercel** (web app): `SERVER_URL=https://syncspace-willpads-api.onrender.com` and `NEXT_PUBLIC_WS_URL=wss://syncspace-willpads-api.onrender.com` (the Render service name in `render.yaml` sets that URL).

On Render's free plan the server sleeps after 15 minutes without traffic, so the first request after a while can take up to a minute. Uploaded files are processed straight into the database, so Render's temporary disk is fine; uploads are capped at 4 MB to fit Vercel's request size limit.

## Screens

| Route | Screen |
| --- | --- |
| `/` | Overview |
| `/login` | Sign in or create an account |
| `/dashboard` | Your rooms with live clocks, join by code, New room dialog (focus/break length, who can join) |
| `/join/<code>` | Where invite links land: joins the room, then opens it |
| `/room/<id>` | The shared room: Ring, Grid or Timeline view, people, your task list, session notes, ambient sound. Becomes the quiz once the host ends the session |

The host (the room's creator) starts, pauses, skips and ends the session, opens or closes invites, and can remove people. Someone the host removes can't rejoin until the host lifts the ban (`DELETE /rooms/:roomId/bans/:userId`; there's no button for it in the web app yet). Everyone else follows the clock. Rooms hold at most 10 people.

## How sync works

The server owns the clock. Every room change is pushed over the room WebSocket as a full snapshot, and while people are connected the server re-sends it every second with the timer worked out from its own clock (no database query per tick). Snapshots carry `serverTime` and the phase's `endsAt`, and the socket answers `time:ping` frames, so a client can line its clock up with the server's; the current web client counts down from the moment it received the last snapshot. Timer writes are versioned, so two simultaneous host actions can't both apply. Presence (who's online vs. away) comes from who has the room open, with heartbeats dropping dead connections.

## Styles

- `src/styles/industry.css`: the Industry design system, from the mockup. Unchanged except that fonts load through `next/font` instead of a Google Fonts `@import`.
- `src/styles/theme.css`: SyncSpace's green Forest/Mist tokens, from the mockup. The theme follows the OS until the sun/moon button sets one.
- `src/styles/app.css`: the mockup's screen styles.
- `src/styles/additions.css`: everything the mockup didn't cover (quiz phase, session notes, notices, empty states), plus the Next.js wiring.

## Not built yet

The mockup also shows room chat, focus stats and scheduled sessions with RSVPs. There's no server support for those yet, so they're left out. Video calling exists as a hook (`src/hooks/useWebRTC.ts`) with server-side signaling, but isn't mounted in the room yet.

## Scripts

- `npm run dev` / `npm run build` / `npm run lint`: web app
- `cd server && npm test`: server test suite (Vitest). It starts its own embedded Postgres in `server/.test-db/` (about 20 seconds the first time) and never reads `server/.env`; set `TEST_DATABASE_URL` to use another database instead.
