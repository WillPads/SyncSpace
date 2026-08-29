# SyncSpace

A synchronous co-working and Pomodoro room app. Create or join a shared room and focus alongside others in real time, with one timer everyone in the room sees the same way.

## Stack

- Next.js 15 (App Router) + TypeScript (strict)
- Tailwind CSS v4 — dark-mode-first, red accent palette, no gradients
- Real-time sync: API routes backed by an in-memory store, polled client-side via SWR — no database, no external services, no environment variables
- Ambient focus sounds (rain / coffee shop / white noise) synthesized live with the Web Audio API — no audio files

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Create a room, or join one with a code, and the timer stays in sync across every tab/browser polling that room.

## How sync works

Room, timer, and participant state live in a single in-memory `Map` on the server (`src/lib/store.ts`), persisted across dev-server hot reloads via `globalThis`. The timer is stored as a `(remainingSeconds, updatedAt)` snapshot rather than a running interval — each client computes the live countdown locally from that snapshot and re-syncs every poll, so every participant's clock agrees regardless of network latency.

This in-memory approach is intentionally zero-config for easy deployment, but it means state is scoped to a single server instance/process and won't survive a restart or be shared across multiple serverless instances.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run lint` — ESLint
