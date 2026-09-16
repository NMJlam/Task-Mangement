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

> Windows users: `nvm use` and `cp` need equivalents and Docker Desktop must be
> running — see [On Windows](#on-windows).

## Fresh clone

```bash
nvm use                                  # Node 24 (.nvmrc)
npm ci                                   # install all workspaces (+ husky hooks)
cp .env.example .env                     # then fill in DATABASE_URL — see below
docker compose up -d                     # throwaway Postgres (local dev only)
npm run db:migrate && npm run db:seed    # auth/app schemas + reproducible seed data
```

Then start both dev servers:

```bash
npm run dev            # frontend :5173, backend :3001; /api is proxied
```

Open <http://localhost:5173>. The `/health` route is the one fully-wired page.

### On Windows

The commands above are bash. In **Windows PowerShell 5.1** (the default shell)
the equivalent is:

```powershell
fnm use --install-if-missing             # or nvm-windows: nvm install 24; nvm use 24
npm ci
Copy-Item .env.example .env              # then fill in DATABASE_URL — see below
docker compose up -d                     # start Docker Desktop first
npm run db:migrate; if ($?) { npm run db:seed }
npm run dev                              # http://localhost:5173
```

Four differences, none of them optional:

- **No `&&`.** Windows PowerShell 5.1 has no pipeline chain operators — `a && b`
  is a parser error. Use `a; if ($?) { b }`, or run the commands separately.
  (PowerShell 7+ and `npm run` scripts are both fine; this only bites you when
  you paste a chained command into the shell.)
- **`cp` → `Copy-Item`**, `nvm use` → `fnm use` or `nvm install 24; nvm use 24`.
  Neither `nvm` nor `fnm` ships with Windows — install one
  (`winget install Schniz.fnm`) or use the Node 24 MSI from nodejs.org.
- **Docker Desktop must actually be running.** Having `docker.exe` on PATH is
  not enough — `docker compose up -d` fails with a named-pipe error
  (`open //./pipe/dockerDesktopLinuxEngine`) until the Desktop app is started.
- **Port 5432**: the macOS IPv6 note in
  [If port 5432 is already taken](#if-port-5432-is-already-taken) doesn't apply.
  Check with `netstat -ano | findstr LISTENING | findstr :5432` — outbound
  connections to a remote `:5432` are not a conflict. If a local Postgres
  service does hold the port, set `POSTGRES_PORT` as described there.

The workspace scripts themselves are cross-platform — no `NODE_ENV=x` prefixes
or shell-isms — so everything past `npm ci` behaves the same. The Husky
`commit-msg` hook runs under Git for Windows' bundled bash.

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
| `db:generate` / `db:migrate` / `db:seed` / `db:studio` | Generate / migrate auth + app schemas / seed / open Drizzle Studio      |
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

### Demo data — `SEED_DEMO=1`

The default seed deliberately populates only `settings`, `auth.user` and
`app_user`: CI runs `db:migrate && db:seed` before the integration tier, so
whatever it writes **is** the shared test fixture, and widening it breaks tests
that assume those six role holders are the only ones. To fill the other
thirteen tables with a coherent demo club — five teams, three events across the
status lifecycle, workstreams, a Kanban board, channels of every kind, threaded
and file messages, one AI run, one expense per status, notifications and audit
rows — opt in:

```bash
SEED_DEMO=1 npm run db:seed          # PowerShell: $env:SEED_DEMO=1; npm run db:seed
```

It adds no `app_user` rows and is idempotent (ids are derived from slugs, every
insert is `ON CONFLICT DO NOTHING`), so the integration suite still passes with
it loaded. Ignored when `NODE_ENV=production`. See
`backend/src/db/seed-demo.ts`.

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

### Test endpoints by hand in the browser (dev only)

Google is the only sign-in method, so with no OAuth credentials you cannot hold
a session in a browser and every protected route answers 401. For local work,
enable password sign-in instead:

1. Set `DEV_PASSWORD_AUTH=1` in `.env` — local only, never on Vercel.
2. `npm run dev`, then open <http://localhost:5173/scratch>.
3. Type an email and password, press **Sign up**. You now have a session but no
   membership, so `GET /api/me` answers 403 `NO_MEMBERSHIP`.
4. Grant membership, choosing the role you want to test as:

   ```bash
   npm run db:dev-member -- dev@example.com president
   ```

5. Send requests from the page: pick a method, type a path such as `/api/teams`,
   add a JSON body if the route takes one, press **Send**. The session cookie
   goes with every request.

Re-run step 4 with a different role (`officer`, `director`, …) to exercise the
tier rules in [`roles-and-permissions.md`](roles-and-permissions.md); `tier` is
derived from `role`, so there is nothing else to keep in sync.

The page is registered only in dev builds and never reaches a production bundle.
See `plan-dev-harness.md` for why the role change is a CLI and not an endpoint.

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
