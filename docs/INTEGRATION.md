# SyncSpace: integrate the new design (INTEGRATION.md)

Read `HANDOFF.md` and `CLAUDE.md` first. This file is the plan for moving the finished UI mockup into the real app. Check the repo state yourself before acting, and explain each change briefly (I'm a student and need to explain it in interviews).

## What's in `docs/design/`

| File | What it is |
| --- | --- |
| `SyncSpaceApp-preview.html` | The clickable mockup: auth, dashboard, room, settings, logged-out page. Open it in a browser. It is the visual source of truth. |
| `tokens.css` / `tokens.json` | Design tokens (colors, type, spacing, radii). `tokens.json` is the source; `tokens.css` is generated from it. |
| `logo/` | Official logo SVGs (mark, lockup, favicon) and usage rules. |

The mockup is a single file of vanilla JS with fake data. **Do not copy its JS.** Recreate each screen as React components using the real API and hooks. Copy its structure, spacing, copy and CSS values.

## Design rules (non-negotiable)

- Flat fills only. **No gradients anywhere**, no glow on the logo. Dots and lines use SVG patterns, not CSS gradients.
- Bento-box layout: 12-column grid, 20px tile radius, 16px gap, tiles tinted with `color-mix(in srgb, var(--fill) 24%, var(--card))`.
- Sub-heading and description text uses `--brand-text-muted` (#c4cbd4) in dark mode so it stays readable.
- Dashboard keeps both the **Notes** notepad (max 5 ruled notes) and the **Quick notes** tile.
- Day mode is derived locally from the dark tokens (see `.app[data-ui="day"]` in the mockup).

## Phases

**Phase 0: deploy first.** HANDOFF.md says feature freeze until the app is live. Finish deployment before anything below that adds features. Phases 1 and 2 are visual only and are allowed during the freeze only if I say so.

**Phase 1: tokens and logo (no behavior change).**

1. Reconcile `docs/design/tokens.css` with `src/styles/theme.css` and `industry.css`. The repo currently uses the Industry design with Barlow. The mockup uses Space Grotesk and JetBrains Mono. Ask me before replacing fonts, and tell me what would change.
2. Replace the logo in `src/components/ui/Brand.tsx` with the new mark. Use the `#logo-mark` colors via CSS variables `--logo-a`, `--logo-b`, `--logo-s`, `--logo-lens` (see `docs/design/logo/README.md`).
3. Copy `docs/design/logo/syncspace-favicon.svg` to `src/app/icon.svg` (Next.js picks it up).

**Phase 2: restyle existing screens to the mockup.** One commit per screen, in this order: login (`src/app/login/page.tsx`), dashboard (`src/app/dashboard/page.tsx`, `components/dashboard/*`), room (`components/room/*`), then the logged-out and settings screens. Keep all current behavior and tests passing; only markup and CSS change.

**Phase 3: features the mockup shows that the backend lacks.** Do these only after deploy, one at a time, backend first with Vitest tests, then the UI:

- Settings sub-pages (profile, password, appearance, delete account). Audit `server/API.md` and `server/src` for which endpoints already exist.
- Room chat (README says there is no server support yet).
- Upcoming sessions / scheduling.
- Dashboard Notes and Quick notes persistence (currently mockup-only state).
- Upload materials from the dashboard and "Make quiz" from a recent file (the document-to-quiz pipeline exists; check how it's triggered today).

Anything in the mockup that the backend can't do yet should be hidden or marked as "coming soon" in the real UI, never faked.

## Rules for every change

- Windows, Git Bash. Small, clearly named commits. Show me the commit message first and commit only when I ask.
- **No `Co-Authored-By` or "Generated with Claude Code" lines** in commits or PRs.
- Never print, log or commit secrets (`server/.env`, the Neon connection string).
- Run `npm run lint` and `npx tsc --noEmit` in the root and `npm test` in `server/` before saying a step is done.
- Don't claim "live" anywhere until it is.
