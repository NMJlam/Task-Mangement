# CLAUDE.md — Club Task Platform

Conventions and architecture for this repo. Read before contributing.

## What this is

Monorepo (npm workspaces) for the MAC club task-management platform,
FIT3161/FIT3162 Team S1_CS_05. TypeScript everywhere, `strict: true`, **no `any`
in committed code**. Deploys to Vercel + Neon; Docker Postgres is local-only.

## Structure

```
api/         Vercel serverless shim — ONE file (see rule below)
frontend/    Vite + React 19 SPA. src/{components,lib,hooks,routes}. Components are
             grouped by feature — `ui/` (shadcn primitives), `common/`, `layout/`,
             and one folder per domain (`events/`, `tasks/`, `members/`).
backend/     Express 4. src/{app.ts,middleware,routes,db,config}
shared/      zod schemas + inferred types — imported by BOTH sides
e2e/         Playwright specs (incl. axe scan)
docs/        setup.md, architecture.md, roles-and-permissions.md, api-endpoints.md,
             contributing.md, stack-versions.md, accessibility.md
```

## Structural rules (enforced, not by discipline)

1. **`shared/` is the only place a domain type is defined.** If a shape exists on
   both sides, it is a zod schema in `shared/` and both import it. `shared/`
   imports no React, no Express, no db — enforced by ESLint `no-restricted-imports`.
2. **`frontend/` never imports `backend/`, and vice versa.** They talk over HTTP
   and share types only through `@ctp/shared`. Cross-imports fail lint.
3. **`api/` holds exactly one file** — `api/index.ts`, a 3-line shim that
   re-exports the Express app via a **relative** import (Vercel file-tracing).
   A second file in `api/` means the layering is wrong.

## Backend middleware chain

Assembled in app order: **`log → authenticate → authorise → validate → handler`**.
`log` is global (`app.ts`); the other three are applied per-route (see
`routes/example/example.ts`). `validate(schema, part)` takes a zod schema **from
`@ctp/shared`** and 422s with the shared `ApiError` shape. `app.ts` does not call
`listen()` — `dev-server.ts`, Vitest, and `api/index.ts` all import the same app.

Authorisation has two middleware, one per axis: `authorise(minTier)` for rank,
`authoriseCapability(cap)` for powers that belong to a named office (tier 2 also
holds the VP, treasurer and secretary — `event:cancel` is the president's
alone). Neither sees the row, so **per-resource** rules ("the owner, or tier 1")
are handler checks gated at the lowest tier that could pass.

## Service layer

A route gets a `service.ts` only once it owns rules that outlive the request —
money, state machines, cross-field invariants. `routes/events/service.ts` is the
reference: framework-free (no `req`/`res`), takes a `Tx`, throws typed errors the
route maps to status codes. That split is what lets the rules be unit-tested with
no database. Most routes don't need one; `routes/example/` is still the default
shape.

## Database

Two factories in `backend/src/db/client.ts`:

- `nodeDb()` (`pg`) — local dev, migrations, seeding, tests → Docker Postgres.
- `httpDb()` (Neon serverless / WebSocket) — request path in production (RR9) →
  Neon only; **throws** on a localhost URL. It uses the Pool-based serverless
  driver (not neon-http) so it shares `nodeDb()`'s transaction + `.rows`
  semantics — routes run the same code against either.

Never import the wrong one into a route. Better Auth owns accounts in
`auth.user`; `public.app_user` stores invite-gated club membership and RBAC.
Accounts may exist without membership. `db:seed` is idempotent.

## Conventions

- **Stub markers:** unfinished logic carries `TODO(Rn)` naming the requirement it
  implements (e.g. `TODO(R7)`), or `TODO(theme)` / `TODO(Vercel path)` for the
  known follow-ups. Grep these to find open work.
- **shadcn-first:** always prefer a shadcn/Radix component over a hand-rolled
  one — that's where keyboard nav + ARIA (R14, US-21) come from. If you must hand-
  roll an interactive element, justify it in the PR and add keyboard handling.
  `eslint-plugin-jsx-a11y` enforces the basics.
- **ViewModel layer:** data-fetching/state lives in `frontend/src/hooks/` (MVVM);
  `routes/` components stay declarative.
- **Theme:** colours are CSS variables in `frontend/src/index.css` (Tailwind v4
  `@theme`). `TODO(theme)` marks the MAC palette swap; re-run the contrast check
  in `docs/accessibility.md` after any change.

## The one command

`npm run verify` = `typecheck && lint && format:check && test:unit &&
test:integration && test:e2e` — the full suite (needs Docker Postgres up +
Playwright browsers). Run it before opening a PR. CI runs the three test suites
as **separate jobs** (`unit` / `integration` / `e2e`) so a red check names the
bucket. For a fast, DB-free inner loop use `npm run test:unit`. See
`docs/setup.md` for the full command table, `docs/contributing.md` for the
testing tiers, and `docs/stack-versions.md` for versions and every deviation from
the original setup brief.
