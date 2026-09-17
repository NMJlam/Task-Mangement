# Stack versions & deviations

Snapshot of what actually installed, plus every place the build deviates from
the setup instructions and why. Update this file when you bump a major version.

## Installed versions

| Package                  | Version | Notes                                  |
| ------------------------ | ------- | -------------------------------------- |
| node (`.nvmrc`)          | 24      | See deviation ①: verified on Node 25.  |
| npm                      | 11.6.2  |                                        |
| typescript               | 5.9.3   |                                        |
| **React**                | 19.2.8  | Upgraded from 18 — deviation ②.        |
| react-dom                | 19.2.8  |                                        |
| react-router-dom         | 6.30.4  | v6 (stable SPA API) — deviation ③.     |
| vite                     | 7.3.6   |                                        |
| @vitejs/plugin-react     | 5.2.0   |                                        |
| **tailwindcss**          | 4.3.3   | **v4** — CSS `@theme`, no config file. |
| @tailwindcss/vite        | 4.3.3   | Vite plugin route (not PostCSS).       |
| zod                      | 4.4.3   | v4.                                    |
| **express**              | 4.22.2  | v4 per instructions.                   |
| drizzle-orm              | 0.45.2  | Also pinned at root — deviation ④.     |
| drizzle-kit              | 0.31.10 |                                        |
| pg                       | 8.22.0  | `nodeDb()` (local/migrations/tests).   |
| @neondatabase/serverless | 1.1.0   | `httpDb()` (request path, RR9).        |
| react-hook-form          | 7.83.0  |                                        |
| @hookform/resolvers      | 5.5.7   |                                        |
| radix-ui                 | 1.6.7   | shadcn now uses the unified package.   |
| sonner                   | 2.0.7   | toasts.                                |
| lucide-react             | 0.545.0 | icons.                                 |
| vitest                   | 3.2.7   |                                        |
| jsdom                    | 27.4.0  | frontend test env.                     |
| @testing-library/react   | 16.3.2  |                                        |
| @playwright/test         | 1.62.0  |                                        |
| @axe-core/playwright     | 4.12.1  |                                        |
| eslint                   | 9.39.5  | flat config.                           |
| typescript-eslint        | 8.65.0  |                                        |
| prettier                 | 3.9.6   |                                        |
| concurrently             | 9.2.4   |                                        |

## Deviations from the instructions

**① Node 24 vs 25.** `.nvmrc` pins Node **24** (the intended dev/CI version;
bumped from 20, which reaches EOL April 2026 and is being retired from GitHub
Actions runners). The machine used to scaffold this had only Node **25**
installed (no nvm), so `npm ci`, `verify`, the dev servers, and the db flow were
all verified under Node 25. Nothing hit a Node-version-specific issue. CI runs
Node 24. **Action:** confirm the team develops on Node 24 (`nvm use`).

**② React 19, not 18 (amended 2026-07-30).** The proposal originally specified
React **18**, and the scaffold shipped on 18.3.1 pinned via root `overrides` (npm
otherwise hoisted React 19 to the root while leaving 18 nested under `frontend/`,
producing the "two copies of React" runtime error). We have since **upgraded to
React 19** (`frontend/package.json` declares `react`/`react-dom@^19`; `@types` at
19). The shadcn/Radix components generated for this repo target React 19's
ref-as-prop model, so under React 18 refs attached to `Input`/`Card`/Radix
`Slot` were silently dropped and logged a `forwardRef` dev warning — harmless for
the current stubs but a latent bug for focus management and Radix positioning
once real forms/overlays land. On 19 the whole tree resolves to a single copy
naturally, so the React `overrides` were **removed** (only the `@esbuild-kit`
alias remains); the warning is gone and `verify` is clean. **Action:** this
contradicts the proposal's React 18 line — record the change (proposal amendment
or supervisor sign-off) so the deviation is traceable at marking.

**③ React Router v6, not v7.** Latest is v7, but v6's `createBrowserRouter` SPA
API is stable and well-documented for a five-person team. Trivial to bump later.

**④ `drizzle-orm` pinned at the repo root too.** `drizzle-kit` hoists to the
root but npm kept `drizzle-orm` nested under `backend/`, so `drizzle-kit
generate` couldn't resolve it ("Please install latest version of drizzle-orm").
Declaring `drizzle-orm` in root `devDependencies` forces a single hoisted copy
next to drizzle-kit. `backend` still depends on it directly for runtime.

**⑤ Docker host port is configurable (`POSTGRES_PORT`, default 5432).**
Instructions said port 5432. The scaffolding machine already ran Postgres on
5432 (and on macOS `localhost` resolves to IPv6 `::1` first, hitting the host
Postgres, not the container). `docker-compose.yml` maps `${POSTGRES_PORT:-5432}`
so the committed default still matches the spec; set `POSTGRES_PORT=5433` (and
match it in `DATABASE_URL`) when 5432 is taken.

**⑥ Env loaded from repo-root `.env`.** npm workspace scripts run with cwd =
`backend/`, so `dotenv`'s default cwd lookup missed the root `.env`.
`backend/src/config/load-env.ts` resolves the root `.env` deterministically
from `import.meta.url`. On Vercel it falls back to platform env.

**⑦ Vercel 5-minute cron omitted.** The proposal wants a 5-minute RR6 warm
ping. The Hobby plan restricts cron to **daily** granularity and a small number
of jobs, so a `*/5 * * * *` schedule is not possible on a zero-budget plan.
`vercel.json` registers **only** the nightly reminder sweep. The
`/api/cron/warm` endpoint exists (CRON_SECRET-guarded) but is unscheduled.
**Action for Nathan:** RR6's mitigation in the risk register needs rewording —
either an external uptime pinger hitting `/api/cron/warm`, or accept cold starts
and re-baseline the p95 target.

## Items that need a live remote to confirm (see §9 of the brief)

These could not be verified locally because no Vercel/Neon remote exists yet:

- **`/api` rewrite path behaviour.** Whether Express sees `/api/health` or
  `/health` in production depends on how Vercel applies the catch-all rewrite.
  `backend/src/app.ts` has a commented path-normalising middleware and
  instructions to enable it if a preview shows the prefix stripped. **Verify on
  the first preview deploy** (log `req.url` / `req.originalUrl`).
- **`api/index.ts` file tracing.** ✅ RESOLVED (2026-07-30). The first prod
  deploy 500'd on every route: `ERR_MODULE_NOT_FOUND: Cannot find module
'/var/task/backend/src/app'`. Root cause: the shim imported
  `../backend/src/app.js`, but Vercel's builder cannot remap a `.js` specifier
  onto `.ts` source, so `backend/` was never traced into the bundle. Fix:
  `backend` now compiles to `backend/dist/` (`tsc -p tsconfig.build.json`) and
  the shim imports the **real** `../backend/dist/app.js`. Dev/tests still run
  from `src` via tsx/vitest. `shared/dist` is pulled in via `includeFiles` in
  `vercel.json` (the `@ctp/shared` workspace symlink can be missed by tracing).
- **`@ctp/shared` resolving without a build step in the Vercel build.** ✅
  RESOLVED (2026-07-30). Done as prescribed: `shared` now has a `build` step and
  its `main`/`types`/`exports` point at `dist/`. `shared/src/index.ts` also
  gained `.js` extensions on its re-exports so the emitted ESM is Node-runnable.
  Dev/tests keep resolving `@ctp/shared` from source via the Vite alias
  (frontend) and a matching vitest alias (backend), so no build is needed in
  dev. The root `build`/`typecheck` scripts build packages first (`build:packages`).
- **Neon serverless driver / RR9 / Sprint-1 load test.** `httpDb()` needs a real
  Neon connection string; it throws on a localhost URL by design. It uses the
  Pool-based `neon-serverless` (WebSocket) driver, not `neon-http`, so it supports
  the interactive transactions the event routes rely on.
