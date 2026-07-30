# Local setup

## Fresh clone — four commands

```bash
nvm use                                  # Node 24 (see .nvmrc)
npm ci                                   # install all workspaces
docker compose up -d                     # throwaway Postgres (local dev only)
npm run db:migrate && npm run db:seed    # schema + reproducible seed data
```

Then `npm run dev` (frontend on :5173, backend on :3001; `/api` is proxied).

Before the first run, copy the env file:

```bash
cp .env.example .env
# then set DATABASE_URL / DATABASE_URL_POOLED to the Docker Postgres:
#   postgresql://ctp:ctp@localhost:5432/ctp
```

### If port 5432 is already taken

Common if you already run Postgres locally (and on macOS `localhost` prefers
IPv6, which may hit your host Postgres instead of the container). Set a free
port in `.env` and keep the URLs in sync:

```bash
POSTGRES_PORT=5433
DATABASE_URL=postgresql://ctp:ctp@localhost:5433/ctp
DATABASE_URL_POOLED=postgresql://ctp:ctp@localhost:5433/ctp
```

## Two database drivers — which URL to use

The backend exposes two factories (`backend/src/db/client.ts`):

- **`nodeDb()`** — the `pg` client. **Default for all local work**: migrations,
  seeding, schema iteration, unit/integration tests. Point it at Docker Postgres.
- **`httpDb()`** — Neon's serverless HTTP driver. This is the path that ships to
  production and the one RR9's mitigation rests on. It **cannot** talk to Docker
  Postgres and **throws immediately** if `DATABASE_URL` looks like localhost.

For any work touching the request-path driver, RR9 connection behaviour, or the
Sprint-1 load test, provision **one free Neon dev branch** and point
`DATABASE_URL` at it. Docker Postgres cannot exercise `httpDb()`.

## Common commands

| Command                          | Does                                                  |
| -------------------------------- | ----------------------------------------------------- |
| `npm run dev`                    | frontend + backend together                           |
| `npm run verify`                 | typecheck + lint + format:check + test (what CI runs) |
| `npm run db:generate`            | generate a migration after a schema change            |
| `npm run db:migrate` / `db:seed` | apply migrations / seed (idempotent)                  |
| `npm run db:studio`              | Drizzle Studio                                        |
| `npm run test:e2e`               | Playwright (starts dev server itself)                 |

`db:seed` is idempotent — safe to re-run; it upserts on fixed UUIDs, so counts
stay at 5 users / 3 teams / 6 events / 30 tasks.

## Repo-owner checklist (GitHub UI — can't be scripted here)

- [ ] Push to a remote and set the default branch to `main`.
- [ ] **Branch protection on `main`**: require 1 approving review, require the
      `verify` CI check to pass, no direct pushes.
- [ ] Add repo **secrets/variables** for any CI job that hits request paths:
      `DATABASE_URL` → the Neon dev branch (not the CI Postgres service).
- [ ] On Vercel: set `CRON_SECRET`, `DATABASE_URL`, Google OAuth vars; run a
      preview deploy and complete the checks in `docs/stack-versions.md`.
