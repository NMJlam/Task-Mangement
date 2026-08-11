# Architecture

How the Club Task Platform is put together and **where new code goes**. This is
the map to read before adding a feature. For running the app see
[`setup.md`](setup.md); for conventions see [`contributing.md`](contributing.md).

## The big picture

A TypeScript monorepo (npm workspaces), `strict: true`, **no `any` in committed
code**. Three runtime packages plus tests and docs:

```text
api/         Vercel serverless shim — ONE file (api/index.ts)
frontend/    Vite + React 19 SPA          src/{components,components/ui,lib,hooks,routes}
backend/     Express 4 API                src/{app.ts,middleware,routes,db,config}
shared/      zod schemas + inferred types — imported by BOTH sides
e2e/         Playwright specs (incl. axe scan)
docs/        this folder
```

The frontend and backend are **separate deployables that talk over HTTP** and
share only _types_, through `@ctp/shared`. Deploys to Vercel + Neon; Docker
Postgres is local-only.

### Request lifecycle, end to end

```text
browser (React SPA)
  │  fetch("/api/…")
  ▼
Vite dev proxy (:5173 → :3001)         ── in production: Vercel rewrites /api/* ─┐
  ▼                                                                              ▼
Express app (backend/src/app.ts)                                    api/index.ts (Vercel shim)
  │  log → authenticate → authorise → validate → handler                        │
  ▼                                                             re-exports the SAME app
Drizzle ORM  ──  getDb()  ──►  Postgres (Docker locally / Neon in prod)
```

The same `app` object is imported by `dev-server.ts`, Vitest, and
`api/index.ts` — `app.ts` never calls `listen()`, so there are no divergent
code paths between dev, test, and prod.

## The three structural rules (enforced by ESLint, not discipline)

1. **`shared/` is the only place a domain type is defined.** If a shape exists on
   both sides, it is a zod schema in `shared/` and both import it. `shared/`
   imports no React, no Express, no db.
2. **`frontend/` never imports `backend/`, and vice versa.** They communicate
   over HTTP and share types only via `@ctp/shared`. Cross-imports fail lint.
3. **`api/` holds exactly one file** — `api/index.ts`, a tiny shim that
   re-exports the compiled Express app via a **relative** import (for Vercel file
   tracing). A second file in `api/` means the layering is wrong.

## Where everything lives

### `shared/` — the contract

```text
shared/src/
  errors.ts            apiErrorSchema / ApiError — the one API error shape
  schemas/             ONE FOLDER PER SCHEMA — schema + its colocated unit test
    example-form/
      example-form.ts
      example-form.test.ts
    audit-fixture/     audit-fixture.ts + audit-fixture.test.ts
    health/health.ts   (no test needed — type-only response shape)
  index.ts             barrel — re-exports everything (with .js extensions for ESM)
```

Only zod schemas and their inferred types. No framework imports. This is the
single source of truth both sides depend on.

### `backend/` — the Express API

```text
backend/src/
  app.ts               the configured app (no listen()); mounts middleware + routes
  dev-server.ts        local entry: imports app, calls listen() on :3001
  env.ts               typed runtime/auth environment access
  auth/auth.ts         self-hosted Better Auth + invite-only account hook
  config/load-env.ts   resolves the repo-root .env deterministically
  middleware/          ONE FOLDER PER CONCERN; index.ts is the barrel
    index.ts             re-exports the chain (log → authenticate → authorise → validate)
    log/log.ts           request logging
    auth/                authN + authZ grouped (two halves of one concern)
      authenticate.ts      session → app_user membership (401/403 fail-closed)
      authorise.ts         tier and capability middleware factories
    validate/            body/query validation — code + its colocated unit test
      validate.ts
      validate.test.ts
  routes/              ONE FOLDER PER FEATURE; index.ts mounts each under /api
    index.ts             imports each feature router and mounts it
    example/             a feature module (the precedent — copy this shape)
      example.ts           the Router + handlers
      example.integration.test.ts   colocated endpoint test
    health/health.ts     GET /api/health
    me/me.ts             GET /api/me membership identity
    members/members.ts   guarded role changes
    invites/invites.ts   invite creation
    cron/cron.ts         cron endpoints (secret-guarded)
  db/
    client.ts          nodeDb() / httpDb() / getDb() factories
    schema/            Drizzle table definitions (one file per table)
    migrate.ts         applies migrations
    seed.ts            idempotent seed
```

### `frontend/` — the React SPA (MVVM)

```text
frontend/src/
  main.tsx             app entry + router
  routes/              page components — declarative, no data-fetching logic
  components/          feature components
  components/ui/       shadcn/ui primitives (Radix-backed) — don't hand-roll these
  hooks/               the ViewModel layer: data-fetching + state (e.g. use-health.ts)
  lib/                 utilities (e.g. cn() in utils.ts)
  index.css            Tailwind v4 @theme tokens (the MAC palette swap lands here)
```

**MVVM split:** `routes/` components stay declarative; anything that fetches or
holds state lives in a hook under `hooks/`. See `use-health.ts` as the pattern.

## Backend middleware chain

Assembled in this order: **`log → authenticate → authorise → validate →
handler`**.

- `log` is **global** (applied once in `app.ts`).
- `authenticate`, `authorise`, `validate` are applied **per-route**, because not
  every route needs all three. See `routes/example/example.ts` for the full shape.
- `validate(schema, part)` takes a zod schema **from `@ctp/shared`** and responds
  **422** with the shared `ApiError` shape on failure; on success it puts the
  parsed value on `res.locals.validated`.

`authenticate` validates the Better Auth session, resolves `public.app_user`,
and fails closed with 401/403. `authorise(minTier)` and `requireCapability(cap)`
enforce the two RBAC axes after authentication.

## Database

Two drivers plus a selector, all in `backend/src/db/client.ts`:

| Factory    | Driver             | Use for                                                |
| ---------- | ------------------ | ------------------------------------------------------ |
| `nodeDb()` | `pg`               | migrations, seeding, local dev, tests (Docker)         |
| `httpDb()` | Neon serverless    | production request path (RR9); **throws on localhost** |
| `getDb()`  | picks one of above | **route handlers** — Docker locally, Neon in prod      |

Route handlers call **`getDb()`** so a single code path runs against Docker in
dev/tests and Neon in production; the "never import the wrong driver" rule is
enforced in that one function. Better Auth owns accounts in `auth.user`; club
membership and RBAC live in `public.app_user`, linked by the auth user id.
`db:seed` is idempotent.

## Testing — where tests live & what goes where

Tests are **colocated** next to the code they cover — never in a separate
top-level `tests/` tree. The **filename decides the tier** and therefore which CI
job runs it:

| Bucket          | File pattern               | Lives next to                    | Tooling                         | DB              |
| --------------- | -------------------------- | -------------------------------- | ------------------------------- | --------------- |
| **Unit**        | `*.test.ts` / `*.test.tsx` | the unit under test              | Vitest (+ RTL on frontend)      | none            |
| **Integration** | `*.integration.test.ts`    | its route in `routes/<feature>/` | Vitest + supertest → real `app` | Docker Postgres |

### The standard (backend)

- **Types → unit.** Every shared zod schema gets a unit test of its valid/invalid
  parsing, at `shared/src/schemas/<name>/<name>.test.ts`. Pure functions and a single
  middleware are also unit-tested **in isolation** (mocked `req`/`res`/`next`, no
  HTTP, no DB), colocated as `<file>.test.ts`.
- **Endpoints → integration.** Every route is tested **as an endpoint**: drive the
  real Express `app` with supertest and assert status + body + DB effect.
  Colocate it **inside the feature folder** as
  `backend/src/routes/<feature>/<feature>.integration.test.ts`.
- **Never unit-test a route handler by mocking `req`/`res`.** Routes are proven
  through the app (integration) so the real middleware chain, status codes, and
  `getDb()` path are exercised. Mock-and-call-the-handler tests are not allowed
  for endpoints.

### What exists today (the reference for each kind)

```text
shared/src/schemas/example-form/example-form.test.ts      unit        — a schema / type
shared/src/schemas/audit-fixture/audit-fixture.test.ts    unit        — a schema / type
backend/src/middleware/validate/validate.test.ts          unit        — a middleware in isolation
backend/src/routes/example/example.integration.test.ts    integration — an endpoint (supertest + DB)
frontend/src/routes/health.test.tsx                       unit        — a component (RTL)
```

The `/api/example/audit` fixture is the **complete worked example**: its schema
(`auditFixtureSchema`) has a unit test, and its endpoint has an integration test
— the same feature covered at both tiers, exactly as the standard prescribes.

Run `npm run test:unit` (no DB) or `npm run test:integration` (needs Docker
Postgres). Full guide, isolation rules, and copy-paste examples:
[`contributing.md`](contributing.md#testing).

## How to add things

### Add a backend route

1. **Define the shape in `shared/`** (rule 1). New folder in `shared/src/schemas/`
   holding the schema and its test — `create-task/create-task.ts` — then re-export
   it from `shared/src/index.ts` (with a `.js` extension). **Add its unit test**
   in the same folder — `create-task/create-task.test.ts` — covering the valid and
   invalid cases (types → unit).

   ```ts
   // shared/src/schemas/create-task/create-task.ts
   import { z } from "zod";
   export const createTaskSchema = z.object({
     title: z.string().min(1).max(120),
     teamId: z.uuid(),
   });
   export type CreateTask = z.infer<typeof createTaskSchema>;
   ```

2. **Create the feature folder and write the route.** One folder per feature
   under `routes/` — `routes/example/` is the precedent. Mirror it:

   ```ts
   // backend/src/routes/tasks/tasks.ts
   import { createTaskSchema, type CreateTask } from "@ctp/shared";
   import { Router } from "express";
   import { getDb } from "../../db/client.js";
   import { tasks } from "../../db/schema/index.js";
   import { authenticate, authorise, validate } from "../../middleware/index.js";

   export const tasksRouter = Router();

   tasksRouter.post(
     "/tasks",
     authenticate,
     authorise,
     validate(createTaskSchema, "body"),
     async (_req, res) => {
       const input = res.locals.validated as CreateTask;
       const [row] = await getDb().insert(tasks).values(input).returning();
       res.status(201).json(row);
     },
   );
   ```

   (The feature folder is one level deeper than the old flat layout, so imports
   into `db/`, `middleware/`, `env.ts` use `../../`.)

3. **Mount it** in `backend/src/routes/index.ts` —
   `import { tasksRouter } from "./tasks/tasks.js"` then `apiRouter.use(tasksRouter)`.
4. **Test the endpoint** with an integration test **inside the feature folder** —
   `backend/src/routes/tasks/tasks.integration.test.ts` — driving the real `app`
   with supertest (see [Testing](#testing--where-tests-live--what-goes-where) above
   and the copy-paste example in [`contributing.md`](contributing.md#testing)). The
   schema already has its unit test from step 1; the route itself is proven as an
   endpoint, not by mocking the handler.

The finished feature module:

```text
backend/src/routes/tasks/
  tasks.ts                      the Router + handlers
  tasks.integration.test.ts     colocated endpoint test
```

> Note: imports use **`.js` extensions** even though the source is `.ts` — this
> is the ESM/NodeNext requirement across the backend.

### Add a shared schema used on both sides

Add a folder under `shared/src/schemas/` (schema + its test), export it from
`index.ts`, and import it in the route's `validate(...)` **and** the frontend
form's `zodResolver`. `schemas/example-form/` is the reference: one schema drives
both the server 422s and the browser form — never redeclare the shape in a
component or a route.

### Add a frontend component / route

1. Prefer a **shadcn/ui** primitive from `components/ui/` for anything
   interactive — that's where keyboard nav + ARIA come from (R14). Add one with
   the shadcn CLI rather than hand-rolling.
2. Put page components in `routes/` and keep them **declarative**.
3. Put fetching/state in a **hook** under `hooks/` (the ViewModel). Pattern:

   ```ts
   // frontend/src/hooks/use-tasks.ts
   import { useEffect, useState } from "react";
   export function useTasks() {
     const [tasks, setTasks] = useState<Task[]>([]);
     useEffect(() => {
       fetch("/api/tasks")
         .then((r) => r.json())
         .then(setTasks);
     }, []);
     return { tasks };
   }
   ```

4. The route component consumes the hook and renders — no `fetch` in the
   component body.

### Add a database table

New file in `backend/src/db/schema/`, export it from `schema/index.ts`, then
`npm run db:generate && npm run db:migrate`. If it needs seed data, extend
`seed.ts` (keep it idempotent with stable conflict targets).

## Stub markers

Unfinished logic carries **`TODO(Rn)`** naming the requirement it implements
(e.g. `TODO(R7)`), or `TODO(theme)` / `TODO(Vercel path)` for known follow-ups.
Grep these to find open work. Testing/reference fixtures (like the
`/api/example/*` routes) are marked as such and are **not** `R`-numbered.
