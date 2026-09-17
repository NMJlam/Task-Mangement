# Link Tasks to Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the task API link a task to an event, so the event features that
already read `task.event_id` (task counts, progress/risk, date-move warnings,
assignee notifications, `?include=tasks`, the calendar) work on real data rather
than only on `db:seed` rows.

**Architecture:** `eventId` joins the task create/update/list schemas in
`@ctp/shared`. The tasks route resolves it like `teamId`/`assignee` (unknown,
cancelled or above-tier → `422 EVENT_NOT_FOUND`). When a task pairs an event
with a team, a new framework-free `routes/tasks/service.ts` declares the team's
`workstream` on first use (`INSERT … ON CONFLICT DO NOTHING`), which satisfies
the composite FK `task_within_declared_workstream` without adding any endpoint.

**Tech Stack:** TypeScript (strict), zod v4, Express 4, Drizzle ORM (node-postgres
locally, Neon HTTP in production), Vitest + supertest, Docker Postgres.

**Spec:** No separate spec. The decision (option A — "auto-declare workstreams,
no new endpoints") was agreed in conversation on 2026-09-17 and is recorded in
_Design decisions_ below. Background: `docs/superpowers/specs/2026-08-27-database-schema-design.md`
(`workstream`, `task`, rule 10, rule 16).

## Global Constraints

- TypeScript `strict: true`; **no `any`** in committed code.
- Domain shapes live only in `shared/`; the backend imports them from `@ctp/shared`.
- Backend middleware order per route: `authenticate → authorise → validate → handler`.
- **No `db.transaction()` in the tasks route.** Production runs the Neon HTTP
  driver, which throws `No transactions support in neon-http driver`.
- **No new endpoints.** Only fields/query params on existing `/api/tasks` routes.
- A reference the caller got wrong is `422` with a named code, never a `404` or a
  raw FK `500` (existing convention: `TEAM_NOT_FOUND`, `ASSIGNEE_NOT_FOUND`).
- An event the caller can't see (above tier, or `cancelled`) is indistinguishable
  from a missing one — same code, same status.
- Must pass: `npm run typecheck`, `npm run lint`, `npm run format:check`,
  `npm run test:unit`, `npm run test:integration` (Docker Postgres up).

## Design decisions

1. **Workstreams are declared on first use.** A task naming both `eventId` and
   `teamId` inserts `(event_id, team_id)` into `workstream` if missing. Rationale:
   the only unique payload on a workstream (`brief`, `lead`, `dueAt`) is not
   writable through any endpoint today, so a dedicated endpoint would exist only
   to satisfy the FK. Consequence (documented): that team now has a workstream,
   so `GET /api/events?teamId=` finds the event, and `DELETE /api/teams/:id`
   answers `409 TEAM_IN_USE`.
2. **The workstream insert is a separate statement before the task write.** No
   transaction (see constraints). If the task write then fails, an empty
   workstream remains — the same state `POST /api/events` with `teamId` creates.
3. **`PATCH` merges the link.** The pair to declare is the stored
   `(eventId, teamId)` overlaid with the patch — `undefined` keeps, `null`
   clears. This is what fixes today's 500 when only `teamId` changes on an
   event-linked task.
4. **The event check applies to the `eventId` the body names**, exactly like
   `teamId` and `assignee`. Reuses the existing (currently unused)
   `visibleEvents(tier)` helper from `routes/events/service.ts`.
5. **Read filters:** `GET /api/tasks` and `GET /api/tasks/overdue` gain
   `?eventId=`, so an event's full task list (not just the 50 embedded by
   `?include=tasks`) is reachable without a new endpoint.

**Out of scope (follow-ups, not in this plan):** tier filtering on `GET /api/tasks*`
reads; excluding tasks of cancelled/hidden events from `GET /api/calendar`; task
`minTier` inheriting the event's; workstream `brief`/`lead` editing.

## File structure

| File                                                 | Change | Responsibility                                                   |
| ---------------------------------------------------- | ------ | ---------------------------------------------------------------- |
| `shared/src/schemas/task/task.ts`                    | Modify | `eventId` on create, update, list and overdue schemas            |
| `shared/src/schemas/task/task.test.ts`               | Modify | Schema unit tests for `eventId`                                  |
| `backend/src/routes/tasks/service.ts`                | Create | `mergeLink`, `workstreamKeys` (pure), `ensureWorkstreams` (db)   |
| `backend/src/routes/tasks/service.test.ts`           | Create | DB-free unit tests for the pure functions                        |
| `backend/src/routes/tasks/tasks.ts`                  | Modify | Event reference check, workstream declaration, `eventId` filters |
| `backend/src/routes/tasks/tasks.integration.test.ts` | Modify | End-to-end link tests incl. the event side                       |
| `backend/src/db/schema/task.ts`                      | Modify | Comment: who satisfies the composite FK                          |
| `backend/src/db/schema/workstream.ts`                | Modify | Comment: how workstream rows get created                         |
| `docs/api-endpoints.md`                              | Modify | Tasks + events sections                                          |

---

### Task 1: `eventId` in the shared task schemas

**Files:**

- Modify: `shared/src/schemas/task/task.ts:63-142`
- Test: `shared/src/schemas/task/task.test.ts`

**Interfaces:**

- Produces: `CreateTask.eventId?: string | null`, `UpdateTask.eventId?: string | null`,
  `ListTasksQuery.eventId?: string`, `OverdueTasksQuery.eventId?: string`
  (all exported from `@ctp/shared`).

- [ ] **Step 1: Write the failing tests**

In `shared/src/schemas/task/task.test.ts`, add `overdueTasksQuerySchema` to the
import list, add `const eventId = "018f3a4b-0000-7000-8000-000000000002";` below
`teamId`, and add these cases:

```ts
// inside describe("createTaskSchema")
it("accepts an eventId, alone or paired with a teamId", () => {
  expect(createTaskSchema.parse({ eventId, title: "Ok" }).eventId).toBe(eventId);
  expect(createTaskSchema.parse({ eventId, teamId, title: "Ok" })).toMatchObject({
    eventId,
    teamId,
  });
});

it("rejects a non-uuid eventId", () => {
  expect(createTaskSchema.safeParse({ eventId: "oweek", title: "Ok" }).success).toBe(false);
});

// inside describe("updateTaskSchema")
it("accepts eventId as the only field, including null to unlink", () => {
  expect(updateTaskSchema.parse({ eventId })).toEqual({ eventId });
  expect(updateTaskSchema.parse({ eventId: null })).toEqual({ eventId: null });
});

// inside describe("listTasksQuerySchema")
it("accepts an eventId filter and rejects a non-uuid one", () => {
  expect(listTasksQuerySchema.parse({ eventId }).eventId).toBe(eventId);
  expect(listTasksQuerySchema.safeParse({ eventId: "oweek" }).success).toBe(false);
});

// new block
describe("overdueTasksQuerySchema", () => {
  it("accepts an eventId filter", () => {
    expect(overdueTasksQuerySchema.parse({ eventId }).eventId).toBe(eventId);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run shared/src/schemas/task/task.test.ts`
Expected: FAIL — zod strips the unknown `eventId` key, so `.eventId` is
`undefined`, `{ eventId }` patches collapse to `{}` and fail the non-empty refine,
and `"oweek"` is accepted.

- [ ] **Step 3: Implement**

In `shared/src/schemas/task/task.ts`, replace the `createTaskSchema` doc comment
and add `eventId` to all four schemas:

```ts
/**
 * `creator` is not accepted from the client — the route stamps it from the
 * session, so a caller cannot attribute work to someone else. `boardOrder` and
 * `minTier` keep their column defaults until the board endpoints land (R8).
 *
 * `eventId` links the task to an event. Paired with a `teamId`, the route
 * declares that team's workstream on the event if it has none yet — see
 * `backend/src/routes/tasks/service.ts`.
 */
export const createTaskSchema = z.object({
  eventId: z.uuid().nullish(),
  teamId: z.uuid().nullish(),
  // …rest unchanged
});

export const updateTaskSchema = z.object({
  eventId: z.uuid().nullish(),
  teamId: z.uuid().nullish(),
  // …rest unchanged
});

export const listTasksQuerySchema = z.object({
  eventId: z.uuid().optional(),
  teamId: z.uuid().optional(),
  // …rest unchanged
});

export const overdueTasksQuerySchema = z.object({
  eventId: z.uuid().optional(),
  teamId: z.uuid().optional(),
  // …rest unchanged
});
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run shared/src/schemas/task/task.test.ts`
Expected: PASS (all cases, old and new).

---

### Task 2: Tasks service — link merging and workstream declaration

**Files:**

- Create: `backend/src/routes/tasks/service.ts`
- Test: `backend/src/routes/tasks/service.test.ts`

**Interfaces:**

- Consumes: `Queryable` type from `backend/src/routes/events/service.ts`;
  `workstreams` table; `newId()` from `backend/src/db/id.ts`.
- Produces:
  - `interface TaskLink { eventId: string | null; teamId: string | null }`
  - `interface WorkstreamKey { eventId: string; teamId: string }`
  - `mergeLink(stored: TaskLink, patch: { eventId?: string | null; teamId?: string | null }): TaskLink`
  - `workstreamKeys(links: readonly { eventId?: string | null; teamId?: string | null }[]): WorkstreamKey[]`
  - `ensureWorkstreams(db: Queryable, keys: readonly WorkstreamKey[]): Promise<void>`

- [ ] **Step 1: Write the failing unit tests**

Create `backend/src/routes/tasks/service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mergeLink, workstreamKeys } from "./service.js";

const eventA = "018f3a4b-0000-7000-8000-00000000000a";
const eventB = "018f3a4b-0000-7000-8000-00000000000b";
const teamA = "018f3a4b-0000-7000-8000-0000000000a1";
const teamB = "018f3a4b-0000-7000-8000-0000000000b1";

describe("mergeLink", () => {
  const stored = { eventId: eventA, teamId: teamA };

  it("keeps both stored sides when the patch mentions neither", () => {
    expect(mergeLink(stored, {})).toEqual(stored);
  });

  it("keeps the stored event when a patch only moves the team — the pair the composite FK checks", () => {
    expect(mergeLink(stored, { teamId: teamB })).toEqual({ eventId: eventA, teamId: teamB });
  });

  it("treats null as unlink, not as 'not mentioned'", () => {
    expect(mergeLink(stored, { eventId: null })).toEqual({ eventId: null, teamId: teamA });
  });
});

describe("workstreamKeys", () => {
  it("needs both sides — standing and event-wide tasks declare nothing", () => {
    expect(
      workstreamKeys([{ eventId: eventA, teamId: null }, { eventId: null, teamId: teamA }, {}]),
    ).toEqual([]);
  });

  it("collapses a batch to one key per (event, team) pair", () => {
    expect(
      workstreamKeys([
        { eventId: eventA, teamId: teamA },
        { eventId: eventA, teamId: teamA },
        { eventId: eventA, teamId: teamB },
        { eventId: eventB, teamId: teamA },
      ]),
    ).toEqual([
      { eventId: eventA, teamId: teamA },
      { eventId: eventA, teamId: teamB },
      { eventId: eventB, teamId: teamA },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run backend/src/routes/tasks/service.test.ts`
Expected: FAIL — `Cannot find module './service.js'` / `Failed to load url`.

- [ ] **Step 3: Implement**

Create `backend/src/routes/tasks/service.ts`:

```ts
import { newId } from "../../db/id.js";
import { workstreams } from "../../db/schema/index.js";
import type { Queryable } from "../events/service.js";

/**
 * The one rule tasks own: a task that names both an event and a team sits in
 * that team's workstream on the event. The composite FK
 * `task_within_declared_workstream` refuses the write otherwise, so the task
 * routes declare the workstream on first use rather than asking for a separate
 * call — pairing a team with an event through a task IS the declaration.
 *
 * Framework-free like `routes/events/service.ts`, so the pure half is
 * unit-tested with no database.
 */

/** Where a task sits. Either side may be null: standing or cross-team work. */
export interface TaskLink {
  eventId: string | null;
  teamId: string | null;
}

export interface WorkstreamKey {
  eventId: string;
  teamId: string;
}

/**
 * The link a PATCH leaves behind. `undefined` keeps the stored side and `null`
 * clears it — collapsing the two would unlink a task every time a patch didn't
 * mention its event.
 */
export function mergeLink(
  stored: TaskLink,
  patch: { eventId?: string | null; teamId?: string | null },
): TaskLink {
  return {
    eventId: patch.eventId === undefined ? stored.eventId : patch.eventId,
    teamId: patch.teamId === undefined ? stored.teamId : patch.teamId,
  };
}

/** The distinct (event, team) pairs among `links` that need a workstream. */
export function workstreamKeys(
  links: readonly { eventId?: string | null; teamId?: string | null }[],
): WorkstreamKey[] {
  const keys = new Map<string, WorkstreamKey>();
  for (const { eventId, teamId } of links) {
    if (eventId && teamId) keys.set(`${eventId}|${teamId}`, { eventId, teamId });
  }
  return [...keys.values()];
}

/**
 * Inserts whichever workstreams are missing. `ON CONFLICT DO NOTHING` on the
 * one-per-team-per-event key makes this idempotent and safe under concurrent
 * requests for the same pair.
 *
 * Deliberately not in a transaction with the task write: production runs the
 * Neon HTTP driver, which has none. A task write that fails afterwards leaves a
 * workstream with no tasks — the same state `POST /api/events` with a `teamId`
 * creates, so nothing downstream reads it as an error.
 */
export async function ensureWorkstreams(
  db: Queryable,
  keys: readonly WorkstreamKey[],
): Promise<void> {
  if (keys.length === 0) return;
  await db
    .insert(workstreams)
    .values(keys.map((key) => ({ id: newId(), ...key })))
    .onConflictDoNothing({ target: [workstreams.eventId, workstreams.teamId] });
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run backend/src/routes/tasks/service.test.ts`
Expected: PASS (5 tests).

---

### Task 3: Wire links into the tasks route

**Files:**

- Modify: `backend/src/routes/tasks/tasks.ts`
- Test: `backend/src/routes/tasks/tasks.integration.test.ts`

**Interfaces:**

- Consumes: Task 1's `eventId` fields; Task 2's `mergeLink`, `workstreamKeys`,
  `ensureWorkstreams`; `visibleEvents(tier: Tier)` from `routes/events/service.ts`.
- Produces: HTTP behaviour —
  - `POST /api/tasks`, `POST /api/tasks/bulk`, `PATCH /api/tasks/:id` accept `eventId`.
  - `422 EVENT_NOT_FOUND` for an unknown, cancelled or above-tier `eventId`.
  - `GET /api/tasks?eventId=`, `GET /api/tasks/overdue?eventId=`.

- [ ] **Step 1: Update test fixtures**

In `tasks.integration.test.ts`:

```ts
import { eq, sql } from "drizzle-orm";
// …
import { appUsers, events, tasks, teams, workstreams } from "../../db/schema/index.js";

const DAY = 24 * HOUR; // after the HOUR const

// team() takes a name: team.name is UNIQUE, and the link tests need two.
async function team(name = "test-task-team") {
  const [row] = await db.insert(teams).values({ id: newId(), name }).returning();
  return row!;
}

async function event(overrides: Partial<typeof events.$inferInsert> = {}) {
  const [row] = await db
    .insert(events)
    .values({
      id: newId(),
      title: "test-task-event",
      startsAt: new Date(Date.now() + DAY),
      ...overrides,
    })
    .returning();
  return row!;
}

async function workstreamTeams(eventId: string) {
  const rows = await db
    .select({ teamId: workstreams.teamId })
    .from(workstreams)
    .where(eq(workstreams.eventId, eventId));
  return rows.map((row) => row.teamId).sort();
}
```

And make `cleanup()` delete events first:

```ts
// Events go first: deleting one cascades to its workstreams and, through the
// composite FK, to their tasks — and workstream.team_id is RESTRICT, so a team
// can't be dropped while one still points at it. After that the remaining FKs
// do NOT cascade: task.team_id and task.creator are ON DELETE SET NULL, and
// app_user.auth_user_id is ON DELETE RESTRICT. …
async function cleanup() {
  await db.execute(sql`DELETE FROM "event" WHERE "title" LIKE 'test-task-%'`);
  // …existing statements unchanged
}
```

- [ ] **Step 2: Write the failing integration tests**

Add a new `describe` block at the end of the outer `describe("/api/tasks")`:

```ts
describe("linking tasks to events", () => {
  it("links a task to an event, and the event's counts and embed see it", async () => {
    const actor = await member("officer", "officer");
    const { id: eventId } = await event();
    signedInAs(actor);

    const created = await request(app).post("/api/tasks").send({ eventId, title: "Print flyers" });

    expect(created.status).toBe(201);
    expect(created.body.task.eventId).toBe(eventId);
    const detail = await request(app).get(`/api/events/${eventId}`).query({ include: "tasks" });
    expect(detail.status).toBe(200);
    expect(detail.body.event.taskCounts).toEqual({ todo: 1, inProgress: 0, blocked: 0, done: 0 });
    expect(detail.body.event.tasks.map((task: { id: string }) => task.id)).toEqual([
      created.body.task.id,
    ]);
  });

  it("declares the team's workstream when a task pairs an event with a team", async () => {
    const actor = await member("officer", "officer");
    const { id: eventId } = await event();
    const { id: teamId } = await team();
    signedInAs(actor);

    const response = await request(app)
      .post("/api/tasks")
      .send({ eventId, teamId, title: "Film the keynote" });

    expect(response.status).toBe(201);
    expect(await workstreamTeams(eventId)).toEqual([teamId]);
    // The event side agrees: GET /events?teamId= is answered from workstreams.
    const byTeam = await request(app).get("/api/events").query({ teamId });
    expect(byTeam.body.items.map((item: { id: string }) => item.id)).toEqual([eventId]);
  });

  it("reuses the workstream for a second task on the same pair", async () => {
    const actor = await member("officer", "officer");
    const { id: eventId } = await event();
    const { id: teamId } = await team();
    signedInAs(actor);

    const first = await request(app).post("/api/tasks").send({ eventId, teamId, title: "One" });
    const second = await request(app).post("/api/tasks").send({ eventId, teamId, title: "Two" });

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(await workstreamTeams(eventId)).toEqual([teamId]);
  });

  it("422s EVENT_NOT_FOUND on an unknown event rather than surfacing an FK violation", async () => {
    const actor = await member("officer", "officer");
    signedInAs(actor);

    const response = await request(app)
      .post("/api/tasks")
      .send({ eventId: UNKNOWN_ID, title: "Orphan" });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("EVENT_NOT_FOUND");
  });

  it.each([
    ["cancelled", { status: "cancelled" as const }],
    ["above the caller's tier", { minTier: 2 }],
  ])(
    "422s EVENT_NOT_FOUND for an event that is %s — the same answer as a missing one",
    async (_label, overrides) => {
      const actor = await member("officer", "officer");
      const { id: eventId } = await event(overrides);
      signedInAs(actor);

      const response = await request(app).post("/api/tasks").send({ eventId, title: "Hidden" });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("EVENT_NOT_FOUND");
    },
  );

  it("moves a task to another team on the same event instead of 500ing on the composite FK", async () => {
    const actor = await member("officer", "officer");
    const { id: eventId } = await event();
    const media = await team("test-task-media");
    const marketing = await team("test-task-marketing");
    await db.insert(workstreams).values({ id: newId(), eventId, teamId: media.id });
    const existing = await seedTask(media.id, { eventId });
    signedInAs(actor);

    const response = await request(app)
      .patch(`/api/tasks/${existing.id}`)
      .send({ teamId: marketing.id });

    expect(response.status).toBe(200);
    expect(response.body.task).toMatchObject({ eventId, teamId: marketing.id });
    expect(await workstreamTeams(eventId)).toEqual([media.id, marketing.id].sort());
  });

  it("links a standing task to an event, keeping its team", async () => {
    const actor = await member("officer", "officer");
    const { id: eventId } = await event();
    const { id: teamId } = await team();
    const existing = await seedTask(teamId);
    signedInAs(actor);

    const response = await request(app).patch(`/api/tasks/${existing.id}`).send({ eventId });

    expect(response.status).toBe(200);
    expect(response.body.task).toMatchObject({ eventId, teamId });
    expect(await workstreamTeams(eventId)).toEqual([teamId]);
  });

  it("unlinks with eventId null and leaves the team alone", async () => {
    const actor = await member("officer", "officer");
    const { id: eventId } = await event();
    const { id: teamId } = await team();
    await db.insert(workstreams).values({ id: newId(), eventId, teamId });
    const existing = await seedTask(teamId, { eventId });
    signedInAs(actor);

    const response = await request(app).patch(`/api/tasks/${existing.id}`).send({ eventId: null });

    expect(response.status).toBe(200);
    expect(response.body.task).toMatchObject({ eventId: null, teamId });
  });

  it("404s a link change on an unknown task", async () => {
    const actor = await member("officer", "officer");
    const { id: eventId } = await event();
    signedInAs(actor);

    const response = await request(app).patch(`/api/tasks/${UNKNOWN_ID}`).send({ eventId });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("TASK_NOT_FOUND");
  });

  it("declares each distinct workstream once for a bulk batch", async () => {
    const actor = await member("director", "director");
    const { id: eventId } = await event();
    const media = await team("test-task-media");
    const marketing = await team("test-task-marketing");
    signedInAs(actor);

    const response = await request(app)
      .post("/api/tasks/bulk")
      .send({
        tasks: [
          { eventId, teamId: media.id, title: "Film" },
          { eventId, teamId: media.id, title: "Edit" },
          { eventId, teamId: marketing.id, title: "Post" },
        ],
      });

    expect(response.status).toBe(201);
    expect(await workstreamTeams(eventId)).toEqual([media.id, marketing.id].sort());
  });

  it("filters GET /api/tasks by eventId", async () => {
    const actor = await member("officer", "officer");
    const oweek = await event({ title: "test-task-oweek" });
    const gala = await event({ title: "test-task-gala" });
    signedInAs(actor);
    await request(app).post("/api/tasks").send({ eventId: oweek.id, title: "Book the booth" });
    await request(app).post("/api/tasks").send({ eventId: gala.id, title: "Book the hall" });
    await request(app).post("/api/tasks").send({ title: "Standing work" });

    const response = await request(app).get("/api/tasks").query({ eventId: oweek.id });

    expect(response.status).toBe(200);
    expect(response.body.tasks.map((task: { title: string }) => task.title)).toEqual([
      "Book the booth",
    ]);
  });

  it("filters GET /api/tasks/overdue by eventId", async () => {
    const actor = await member("officer", "officer");
    const { id: eventId } = await event();
    const past = new Date(Date.now() - HOUR).toISOString();
    signedInAs(actor);
    await request(app)
      .post("/api/tasks")
      .send({ eventId, title: "Late for the event", dueAt: past });
    await request(app).post("/api/tasks").send({ title: "Late elsewhere", dueAt: past });

    const response = await request(app).get("/api/tasks/overdue").query({ eventId });

    expect(response.status).toBe(200);
    expect(response.body.tasks.map((task: { title: string }) => task.title)).toEqual([
      "Late for the event",
    ]);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run --config backend/vitest.integration.config.ts src/routes/tasks/tasks.integration.test.ts`
Expected: the new block FAILS (eventId stripped → `null`; FK violations → `500`
on the PATCH team move and bulk; unfiltered lists), the existing blocks still PASS.

- [ ] **Step 4: Implement in `tasks.ts`**

Imports:

```ts
import { /* …existing… */ type Tier } from "@ctp/shared";
import { appUsers, events, tasks, teams } from "../../db/schema/index.js";
import { visibleEvents } from "../events/service.js";
import { ensureWorkstreams, mergeLink, workstreamKeys } from "./service.js";
```

Reference check (replaces `Reference` and `findBadReference`):

```ts
type Reference = { eventId?: string | null; teamId?: string | null; assignee?: string | null };

/**
 * Resolve the foreign keys before writing.
 *
 * `task.event_id`, `task.team_id` and `task.assignee` are all FK-constrained, so
 * an unknown id would otherwise surface as an opaque 500 from Postgres. Checking
 * them here turns each into a 422 that names the offending field.
 *
 * An event must also be one the caller can see. Above their tier or cancelled
 * (the soft delete) reads as missing, as on every event route — a different
 * code would confirm the event exists.
 */
async function findBadReference(
  db: ReturnType<typeof getDb>,
  references: Reference[],
  tier: Tier,
): Promise<{ code: string; message: string } | undefined> {
  const eventIds = [...new Set(references.map((reference) => reference.eventId).filter(isId))];
  const teamIds = [...new Set(references.map((reference) => reference.teamId).filter(isId))];
  const assignees = [...new Set(references.map((reference) => reference.assignee).filter(isId))];

  if (eventIds.length > 0) {
    const found = await db
      .select({ id: events.id })
      .from(events)
      .where(and(inArray(events.id, eventIds), visibleEvents(tier)));
    const missing = eventIds.find((id) => !found.some((row) => row.id === id));
    if (missing) return { code: "EVENT_NOT_FOUND", message: `No event with id ${missing}.` };
  }

  // …team and assignee checks unchanged
}
```

`GET /api/tasks` and `GET /api/tasks/overdue` filters — add as the first entry
of each `filters` array (overdue: after the `ne(tasks.status, "done")` line):

```ts
query.eventId ? eq(tasks.eventId, query.eventId) : undefined,
```

`POST /api/tasks` — pass the tier and declare before the insert:

```ts
const bad = await findBadReference(db, [input], req.user!.tier);
if (bad) {
  res.status(422).json({ error: bad });
  return;
}

await ensureWorkstreams(db, workstreamKeys([input]));
```

`POST /api/tasks/bulk`:

```ts
const bad = await findBadReference(db, input.tasks, req.user!.tier);
// …422 unchanged
await ensureWorkstreams(db, workstreamKeys(input.tasks));
```

`PATCH /api/tasks/:id`:

```ts
const bad = await findBadReference(db, [patch], req.user!.tier);
if (bad) {
  res.status(422).json({ error: bad });
  return;
}

// Moving either side of the link can land the task on a pair with no
// workstream — a new team on the same event is the common case — so work out
// the link the row will end up with and declare it before the update.
if (patch.eventId !== undefined || patch.teamId !== undefined) {
  const [stored] = await db
    .select({ eventId: tasks.eventId, teamId: tasks.teamId })
    .from(tasks)
    .where(eq(tasks.id, req.params.id!))
    .limit(1);
  if (!stored) {
    notFound(res);
    return;
  }
  await ensureWorkstreams(db, workstreamKeys([mergeLink(stored, patch)]));
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run --config backend/vitest.integration.config.ts src/routes/tasks/tasks.integration.test.ts`
Expected: PASS, every block.

---

### Task 4: Docs, schema comments, full verification

**Files:**

- Modify: `docs/api-endpoints.md` (Tasks section ~201-263, Events POST ~399)
- Modify: `backend/src/db/schema/task.ts:102-107`
- Modify: `backend/src/db/schema/workstream.ts:6-17`

- [ ] **Step 1: API docs**

In the tasks table, change the two list rows' input column to
`?eventId&teamId&status&priority&assignee&limit&offset` and
`?eventId&teamId&assignee&limit&offset`. Add `"eventId": "<uuid>",` as the second
line of the create-body example. Replace the unknown-reference bullet and add a
workstream bullet:

```md
- **An unknown `eventId`, `teamId` or `assignee` is a `422`**, with code
  `EVENT_NOT_FOUND`, `TEAM_NOT_FOUND` or `ASSIGNEE_NOT_FOUND` — not a `404`,
  because it's your input that's wrong. A cancelled event, or one above your
  tier, is `EVENT_NOT_FOUND` too.
- **An event plus a team puts that team on the event.** A task naming both
  creates the team's workstream on the event if it has none — there is no
  separate call. The event then shows under `GET /api/events?teamId=`, and the
  team can no longer be deleted (`409 TEAM_IN_USE`). On `PATCH` the pair is your
  patch laid over the stored task, so changing only `teamId` is fine;
  `"eventId": null` unlinks.
```

In the Events `POST` notes, change "`teamId` seeds a workstream row, it is not a
column on the event" to "`teamId` seeds a workstream row (so does a task naming
the event and a team), it is not a column on the event".

Then run `npx prettier --write docs/api-endpoints.md` to realign the table.

- [ ] **Step 2: Schema comments**

`backend/src/db/schema/task.ts`, the composite-FK comment gains:

```ts
// The task routes declare the workstream on first use
// (`routes/tasks/service.ts`), so the API never trips this; only a direct
// insert can.
```

`backend/src/db/schema/workstream.ts`, doc comment gains a paragraph:

```ts
 * Rows are created by `POST /api/events` (its `teamId`) or on first use by a
 * task naming the event and a team (`routes/tasks/service.ts`). There is no
 * workstream endpoint — `brief`, `lead` and `due_at` are seed-only until one
 * is needed.
```

- [ ] **Step 3: Full verification**

Run, in order, and require each to pass:
`npm run typecheck` → `npm run lint` → `npm run format:check` →
`npm run test:unit` → `npm run test:integration`.

- [ ] **Step 4: Commit (when the user asks)**

```bash
git add shared/src/schemas/task backend/src/routes/tasks backend/src/db/schema/task.ts \
  backend/src/db/schema/workstream.ts docs/api-endpoints.md docs/superpowers/plans
git commit -m "feat(tasks): link tasks to events and declare workstreams on first use"
```
