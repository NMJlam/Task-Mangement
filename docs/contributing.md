# Contributing

Conventions for working in this repo — Team **S1_CS_05**. Read
[`setup.md`](setup.md) first to get running, and [`architecture.md`](architecture.md)
for where code goes. This guide is about **how we commit, branch, test, and open
PRs**.

## The one gate

```bash
npm run verify
```

`typecheck && lint && format:check && test:unit && test:integration && test:e2e`.
Run it before opening a PR — it's the whole suite. It needs **Docker Postgres
up** and Playwright browsers installed (`npx playwright install`). For a fast
inner loop, run `npm run test:unit` (no database needed) and lean on CI for the
DB-backed and browser suites.

## Commits — Conventional Commits

Commit messages **must** follow [Conventional Commits](https://www.conventionalcommits.org/).
This is enforced: a `.husky/commit-msg` hook runs `commitlint` and **rejects a
non-conforming message** (hooks install automatically on `npm ci` via the
`prepare` script).

```text
<type>(<optional scope>): <subject>
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`,
`ci`, `chore`, `revert`.

```bash
git commit -m "feat(tasks): add create-task route and schema"
git commit -m "fix(auth): 401 on expired session cookie"
git commit -m "docs: document the integration-test workflow"
git commit -m "test(tasks): cover the 422 path for create-task"
```

Keep the subject imperative and lower-case, no trailing period. Put the
requirement ID (`R7`, `US-21`) in the body if it helps traceability.

## Branches

Name branches **`<student_identifier>/<short-description>`**:

```text
smith0024/task-crud
doe1234/fix-health-flake
```

- `<student_identifier>` — the string before the "@" on your Monash email.
- `<short-description>` — kebab-case, a few words on the work.

Branch off `main`; open a PR back into `main`. Direct pushes to `main` are
blocked by branch protection.

## Pull requests

### Keep them small

**Aim for under ~250 changed lines** (excluding lockfiles and generated
migrations). One requirement / logical change per PR. Large PRs are hard to
review well and hold up the team — if a change is growing past ~250 lines, split
it into stacked PRs. This is a strong norm, not a hard gate; reviewers may push
back on oversized PRs.

### PR description

There's no auto-populated template — **paste this into the PR body** and fill it
in (it keeps the RTM/DoD traceability required by §4.5):

```markdown
## Requirement(s)

Addresses: <!-- e.g. R7, US-21 — the RTM ID(s) this PR implements -->

## What & why

## Definition of Done (§4.5)

- [ ] Code reviewed and ready to merge
- [ ] Tests passing (`npm run verify` green)
- [ ] **RTM updated** for the requirement(s) above

## Notes

<!-- If you hand-rolled any interactive element instead of using a shadcn/Radix
     component, explain why and what keyboard handling you added (R14). -->
```

Use a **Conventional-Commit-style PR title** too (e.g. `feat(tasks): create-task
route`) — it mirrors the commit convention and reads well in the merge log.

### Review

PRs need **2 approving reviews** and all CI checks green before merge. CI runs
three buckets — see below — so a red check tells you exactly what broke.

## Testing

Three tiers, each with its own script and CI job. Test at the **lowest tier that
proves the behaviour**.

**The standard (backend), in one line:** _types → unit, endpoints →
integration._ Concretely:

- **Types & pure logic → unit** (`*.test.ts`). Every shared zod schema gets a
  unit test of its valid/invalid parsing; pure functions and single middleware
  are unit-tested in isolation (mocked `req`/`res`, no DB).
- **Endpoints → integration** (`*.integration.test.ts`). Every route is tested as
  an endpoint through the real `app` with supertest. **Never** unit-test a route
  handler by mocking `req`/`res`.
- Tests are **colocated** next to the code they cover; the filename pattern
  decides the tier and the CI job. See
  [`architecture.md`](architecture.md#testing--where-tests-live--what-goes-where)
  for the placement map.

| Tier            | Command                    | Tool                       | Tests                                                          | DB?             |
| --------------- | -------------------------- | -------------------------- | -------------------------------------------------------------- | --------------- |
| **Unit**        | `npm run test:unit`        | Vitest (+ RTL on frontend) | pure logic, one middleware, a schema, a component in isolation | none            |
| **Integration** | `npm run test:integration` | Vitest + supertest         | a route through the full middleware chain, against a real DB   | Docker Postgres |
| **E2E**         | `npm run test:e2e`         | Playwright                 | a full user journey in the browser + axe scan                  | seeded Postgres |

In CI these are **three separate jobs** (`unit`, `integration`, `e2e`), so a red
check names the bucket that failed.

### Frontend tests (unit / component)

React Testing Library + Vitest (`jsdom`). Query by role/text like a user would;
stub `fetch` for hooks. Files are `*.test.tsx` next to the component. Pattern —
`frontend/src/routes/health.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HealthPage } from "./health";

describe("HealthPage", () => {
  it("renders the heading", () => {
    render(<HealthPage />);
    expect(screen.getByRole("heading", { name: /club task platform/i })).toBeInTheDocument();
  });
});
```

### Backend unit tests

For pure logic and single middleware, call the function directly with mocked
`req`/`res`/`next` — no HTTP, no DB. Files are `*.test.ts`, colocated inside the
middleware's folder. Pattern —
`backend/src/middleware/validate/validate.test.ts`.

### Backend integration tests (supertest)

When you need to prove a **route** works — the real middleware chain, real
status codes, real DB writes — write a `*.integration.test.ts`. It drives the
exported Express `app` in-process with **supertest** (no port, no running
server, because `app.ts` never calls `listen()`).

Routes live one folder per feature (`routes/<feature>/`), and the endpoint test
sits **inside that folder** next to the route. Pattern —
`backend/src/routes/example/example.integration.test.ts`:

```ts
import { sql } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../../app.js";
import { nodeDb } from "../../db/client.js";
import { auditLog } from "../../db/schema/index.js";

describe("POST /api/example/audit (integration)", () => {
  const db = nodeDb();
  // Isolate by truncating ONLY the table this route writes to.
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE ${auditLog}`);
  });

  it("inserts a row and returns it (201)", async () => {
    const res = await request(app)
      .post("/api/example/audit")
      .send({ action: "task.updated", entityType: "task" });
    expect(res.status).toBe(201);
    expect(await db.select().from(auditLog)).toHaveLength(1);
  });
});
```

**Isolation rule:** clean only the rows or tables your test writes. Never truncate
shared seed tables — other tests and Drizzle Studio may depend on them.

> **These tests exercise the `pg`/`nodeDb` driver, not the Neon serverless driver
> that ships to production.** Both are Pool-based and share transaction + raw
> `.execute().rows` semantics, so CRUD *and* transactions are covered — but
> genuinely Neon-specific behaviour (RR9 connection pooling, the Sprint-1 load
> test) is **verified separately** against a real Neon dev branch and preview
> deploy, per [`stack-versions.md`](stack-versions.md). Don't assume integration
> tests cover the Neon path.

### When to reach for E2E

Use Playwright (`e2e/`) only for **full user journeys through the browser** and
the **accessibility scan** (`@axe-core/playwright`) — not for logic a unit or
integration test can cover more cheaply. Add an axe scan per new page as the UI
grows (R14).

### Verifying by hand (curl + Drizzle)

Before or alongside writing a test, sanity-check a route with `curl` and confirm
the DB state in Drizzle Studio or a `tsx` one-liner — see the
[curl + Drizzle workflow](setup.md#verify-a-route-by-hand--curl--drizzle) in
`setup.md`.

## Accessibility (R14)

Always prefer a **shadcn/Radix** component over a hand-rolled interactive
element — that's where keyboard nav + ARIA come from. If you must hand-roll one,
justify it in the PR and add keyboard handling; `eslint-plugin-jsx-a11y`
enforces the basics. After any theme/colour change, re-run the contrast check in
[`accessibility.md`](accessibility.md).
