# Setup & developer workflow

Everything you need to get the Club Task Platform running locally and to work in
it day to day. For architecture and "where does this code go", see
[`architecture.md`](architecture.md); for conventions and how to contribute, see
[`contributing.md`](contributing.md).

## Prerequisites

- **Node 24** — the version in [`.nvmrc`](../.nvmrc) and CI. Run `nvm use`.
- **npm 11+** (ships with Node 24).
- **Docker** — for the local Postgres container. Local dev only; production is
  Neon.

## Fresh clone

```bash
nvm use                                  # Node 24 (.nvmrc)
npm ci                                   # install all workspaces (+ husky hooks)
cp .env.example .env                     # then fill in DATABASE_URL — see below
docker compose up -d                     # throwaway Postgres (local dev only)
docker compose exec -T postgres psql -U ctp -d ctp -c 'CREATE SCHEMA IF NOT EXISTS auth;'
npx @better-auth/cli migrate --config backend/src/auth/auth.ts -y
npm run db:migrate && npm run db:seed    # schema + reproducible seed data
```

Then start both dev servers:

```bash
npm run dev            # frontend :5173, backend :3001; /api is proxied
```

Open <http://localhost:5173>. The `/health` route is the one fully-wired page.

### The `.env` file

`npm ci` won't fill this in. Copy the example and set the database URLs:

```bash
cp .env.example .env
# Local Docker default:
#   DATABASE_URL=postgresql://ctp:ctp@localhost:5432/ctp
#   DATABASE_URL_POOLED=postgresql://ctp:ctp@localhost:5432/ctp
```

Env is loaded from the **repo-root `.env`** (workspace scripts run with cwd =
`backend/`, so `backend/src/config/load-env.ts` resolves the root file
deterministically). On Vercel it falls back to platform env.

### If port 5432 is already taken

Common if you already run Postgres locally (and on macOS `localhost` prefers
IPv6, which may hit your host Postgres instead of the container). Set a free port
in `.env` and keep the URLs in sync:

```bash
POSTGRES_PORT=5433
DATABASE_URL=postgresql://ctp:ctp@localhost:5433/ctp
DATABASE_URL_POOLED=postgresql://ctp:ctp@localhost:5433/ctp
```

`docker-compose.yml` maps `${POSTGRES_PORT:-5432}`, so this stays in sync.

## Two database drivers — which URL to use

The backend exposes three factories in `backend/src/db/client.ts`:

- **`nodeDb()`** — the `pg` client. **Default for all local work**: migrations,
  seeding, schema iteration, unit/integration tests. Points at Docker Postgres.
- **`httpDb()`** — Neon's serverless HTTP driver. The path that ships to
  production and the one RR9's mitigation rests on. It **cannot** talk to Docker
  Postgres and **throws immediately** if `DATABASE_URL` looks like localhost.
- **`getDb()`** — picks `nodeDb()` for a local URL and `httpDb()` for a Neon URL.
  **Route handlers call this**, so the same code runs on Docker locally/in tests
  and on Neon in production. (See [`architecture.md`](architecture.md).)

For any work touching the request-path driver, RR9 connection behaviour, or the
Sprint-1 load test, provision **one free Neon dev branch** and point
`DATABASE_URL` at it. Docker Postgres cannot exercise `httpDb()`.

## Scripts

| Script                                                 | Does                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `dev`                                                  | frontend + backend concurrently                                         |
| `dev:frontend` / `dev:backend`                         | run one side                                                            |
| `build`                                                | build shared + backend, then the frontend                               |
| `typecheck`                                            | `build:packages`, then per-workspace `tsc` + `tsc -p api/tsconfig.json` |
| `lint` / `lint:fix`                                    | ESLint (flat config)                                                    |
| `format` / `format:check`                              | Prettier                                                                |
| `test:unit`                                            | Vitest unit/component tests — **no database needed**                    |
| `test:integration`                                     | Vitest + supertest, DB-backed — **needs Docker Postgres**               |
| `test:e2e`                                             | Playwright (health render + axe scan)                                   |
| `db:generate` / `db:migrate` / `db:seed` / `db:studio` | Drizzle: generate a migration / apply / seed / open Studio              |
| **`verify`**                                           | typecheck + lint + format:check + **all three test suites**             |

> **`npm run verify` runs the entire suite** (including `test:integration` and
> `test:e2e`), so it needs **Docker Postgres up** and Playwright browsers
> installed (`npx playwright install`). For a fast inner loop with zero setup,
> run `npm run test:unit`. CI runs the three suites as **separate jobs** (unit /
> integration / e2e) so a failure names its bucket — see
> [`contributing.md`](contributing.md).

## Common workflows

### Run the app

```bash
npm run dev                 # both servers
npm run dev:backend         # backend only, :3001
npm run dev:frontend        # frontend only, :5173 (proxies /api to :3001)
```

### Change the database schema

Schema lives in `backend/src/db/schema/`. After editing it:

```bash
npm run db:generate         # writes a new SQL migration from the schema diff
npm run db:migrate          # applies it to your local Postgres
npm run db:seed             # idempotent — safe to re-run
```

`db:seed` creates one membership for each of the six roles and is safe to run repeatedly.

### Browse the database — Drizzle Studio

```bash
npm run db:studio           # opens Drizzle Studio in the browser
```

A GUI over your local Postgres for inspecting rows, running quick queries, and
sanity-checking a migration or seed. Handy right after `db:seed` to confirm the
tables look right.

### Verify a route by hand — curl + Drizzle

With `npm run dev` running, hit the backend directly (`:3001`) or through the
frontend proxy (`:5173`):

```bash
# The one fully-wired GET:
curl -s http://localhost:3001/api/health | jq
# → { "ok": true, "commit": "…" }

# A DB-backed POST (the reference fixture route; writes one audit_log row):
curl -s -X POST http://localhost:3001/api/example/audit \
  -H 'content-type: application/json' \
  -d '{ "action": "task.updated", "entityType": "task" }' | jq
```

Then confirm what landed in the database, either in **Drizzle Studio**
(`npm run db:studio`) or with a throwaway query script run through `tsx`:

```bash
# from backend/
npx tsx -e "import {nodeDb} from './src/db/client.js'; import {auditLog} from './src/db/schema/index.js'; console.log(await nodeDb().select().from(auditLog))"
```

## Repo-owner checklist (GitHub / Vercel UI — can't be scripted here)

- [ ] Push to a remote and set the default branch to `main`.
- [ ] **Branch protection on `main`**: require 2 approving reviews, require the
      `unit`, `integration`, and `e2e` CI checks to pass, no direct pushes.
- [ ] **CI needs no database secret.** The `integration` and `e2e` jobs run
      against the workflow's Postgres service container (`nodeDb()`/pg), so the
      whole suite reproduces locally with `npm run verify` before anything is
      pushed. CI never points at Neon — Neon is a production-only concern
      (next bullet).
- [ ] On Vercel: set `CRON_SECRET`, `DATABASE_URL`, Google OAuth vars; run a
      preview deploy and complete the checks in
      [`stack-versions.md`](stack-versions.md).
