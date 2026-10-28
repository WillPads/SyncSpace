# SyncSpace: instructions for Claude Code

Start every session by reading `HANDOFF.md`, then check git status yourself. For the UI redesign, read `docs/INTEGRATION.md`.

## Hard rules

- Windows with the Git Bash terminal.
- Do not add `Co-Authored-By` or "Generated with Claude Code" lines to commits or PRs.
- Commit only when I ask, and show me the message first. Keep commits small and clearly named.
- Never print, log or commit secrets (`server/.env`, the Neon connection string).
- Feature freeze until the app is deployed: bug fixes and deploy work only, unless I say otherwise.
- Explain each change briefly (what and why). I'm a student and need to explain it in interviews.
- Keep the resume claims in `HANDOFF.md` true.

## Design rules

- Visual source of truth: `docs/design/SyncSpaceApp-preview.html`, with tokens in `docs/design/tokens.css` and the logo in `docs/design/logo/`.
- Flat fills only. No gradients, ever. No glow or shadow on the logo.
- Bento-box layout. Muted text uses `--brand-text-muted`.
- Don't copy the mockup's JS or fake data. Rebuild screens as React components on the real API.

## Layout

Frontend at the repo root (Next.js 15 App Router, TypeScript, plain CSS in `src/styles/`). Backend in `server/` (Express 5, Prisma, Postgres, `ws`). Tests: `cd server && npm test`.
