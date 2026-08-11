# Club Task Platform

Task-management platform for the MAC club — FIT3161/FIT3162 Team **S1_CS_05**.

A TypeScript monorepo (npm workspaces): a Vite + React 19 frontend, an Express 4
backend, and a `shared` package of zod schemas used by both. Deploys to Vercel +
Neon; Docker Postgres is for local development only.

> This repository is currently a **scaffold**: wiring, tooling, and stubs only.
> Feature work (R1–R15) lands from Increment 1. Stubs are marked `TODO(Rn)`.

## Quick start

```bash
nvm use                                  # Node 24 (.nvmrc)
npm ci
cp .env.example .env                     # then fill in DATABASE_URL (see setup)
docker compose up -d                     # local Postgres
npm run db:migrate && npm run db:seed
npm run dev                              # http://localhost:5173
```

Full setup, scripts, and workflows: **[`docs/setup.md`](docs/setup.md)**.

## Documentation

- **Setup & developer workflow** — [`docs/setup.md`](docs/setup.md)
- **Architecture & where code goes** — [`docs/architecture.md`](docs/architecture.md)
- **Contributing** (commits, branches, PRs, testing) — [`docs/contributing.md`](docs/contributing.md)
- Versions & deviations — [`docs/stack-versions.md`](docs/stack-versions.md)
- Accessibility (R14) evidence — [`docs/accessibility.md`](docs/accessibility.md)
- Agent/architecture conventions — [`CLAUDE.md`](CLAUDE.md)
