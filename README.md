# Club Task Platform

Task-management platform for the MAC club — FIT3161/FIT3162 Team **S1_CS_05**.

A TypeScript monorepo (npm workspaces): a Vite + React frontend, an Express
backend, and a `shared` package of zod schemas used by both. Deploys to Vercel +
Neon; Docker Postgres is for local development only.

> This repository is currently a **scaffold**: wiring, tooling, and stubs only.
> Feature work (R1–R15) lands from Increment 1. Stubs are marked `TODO(Rn)`.

## Quick start

```bash
nvm use                                  # Node 24 (.nvmrc)
npm ci
cp .env.example .env                     # then fill in DATABASE_URL (see docs)
docker compose up -d                     # local Postgres
npm run db:migrate && npm run db:seed
npm run dev                              # http://localhost:5173
```

Full details, driver/URL guidance, and the repo-owner checklist:
[`docs/local-setup.md`](docs/local-setup.md).

## Scripts

| Script                                                 | Does                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| `dev`                                                  | frontend + backend concurrently                                |
| `dev:frontend` / `dev:backend`                         | run one side                                                   |
| `build`                                                | build the frontend                                             |
| `typecheck`                                            | `tsc --noEmit` across all workspaces + `api/`                  |
| `lint` / `lint:fix`                                    | ESLint (flat config)                                           |
| `format` / `format:check`                              | Prettier                                                       |
| `test`                                                 | Vitest (jsdom for frontend, node for backend/shared)           |
| `test:e2e`                                             | Playwright (health render + axe scan)                          |
| `db:generate` / `db:migrate` / `db:seed` / `db:studio` | Drizzle + seed                                                 |
| **`verify`**                                           | `typecheck && lint && format:check && test` — **what CI runs** |

## Layout

```
api/       Vercel serverless shim (one file)
frontend/  React 19 SPA (Vite, Tailwind v4, shadcn/ui)
backend/   Express 4 API (Drizzle ORM, Neon + pg)
shared/    zod schemas + types shared by both sides
e2e/       Playwright specs
docs/      setup, versions/deviations, accessibility evidence
```

See [`CLAUDE.md`](CLAUDE.md) for architecture and conventions, and
[`docs/stack-versions.md`](docs/stack-versions.md) for installed versions and
deviations from the setup brief.

## Documentation

- Architecture & conventions — [`CLAUDE.md`](CLAUDE.md)
- Local setup — [`docs/local-setup.md`](docs/local-setup.md)
- Versions & deviations — [`docs/stack-versions.md`](docs/stack-versions.md)
- Accessibility (R14) evidence — [`docs/accessibility.md`](docs/accessibility.md)
- Proposal — _TODO: link the team proposal document._
