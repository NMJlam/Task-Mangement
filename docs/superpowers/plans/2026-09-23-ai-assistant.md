# AI Assistant (R15) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a club assistant at `/ai` that reads live club data through tools, proposes tasks and events in a card a human edits and confirms, and applies them under that member's own permissions — plus a dashboard briefing and event thread summaries.

**Architecture:** `routes/ai/` owns every AI endpoint and the cross-cutting rules (kill switch, daily cap, `ai_run` audit row). The provider sits behind a single injected `CompletionFn`, so services and tools are unit-testable with no network. Read tools issue short per-run handles rather than UUIDs; proposal tools stage a card that writes nothing; `POST /api/ai/proposals/apply` performs every checked operation in one `Tx`, re-authorised per operation against the same gate its equivalent route uses.

**Tech Stack:** TypeScript (`strict`, no `any`), Express 4, Drizzle, zod 4, React 19 + Vite, Vitest, Playwright, `@google/genai` (Gemini).

**Spec:** [`../specs/2026-09-23-ai-assistant-design.md`](../specs/2026-09-23-ai-assistant-design.md). Read it first — this plan argues from it. Requirements in [`docs/prd.md`](../../prd.md) (R3, R4, R7, R9, R14, R15), structure in [`docs/architecture.md`](../../architecture.md), permissions in [`docs/roles-and-permissions.md`](../../roles-and-permissions.md), endpoint conventions in [`docs/api-endpoints.md`](../../api-endpoints.md), testing tiers in [`docs/contributing.md`](../../contributing.md).

## Global Constraints

Every task's requirements implicitly include this section.

- **No `any` in committed code.** `strict: true` everywhere (`CLAUDE.md`).
- **`shared/` is the only place a domain type is defined.** Every AI request and response shape is a zod schema in `shared/src/schemas/ai/ai.ts`, imported by both sides. `shared/` imports no React, no Express, no db.
- **`frontend/` never imports `backend/`, and vice versa.** Cross-imports fail lint.
- **`api/` holds exactly one file.** Nothing here adds to it.
- **Middleware order is `log → authenticate → authorise → validate → handler`.** `log` is global in `app.ts`; the rest are per-route. Copy `routes/example/example.ts`.
- **Routes call `getDb()`**, never `nodeDb()` or `httpDb()` directly.
- **The model never emits a UUID.** It emits handles (`T7`, `E2`) that a read tool issued this run, and refs (`$event1`) for rows staged in the same card. The server resolves both.
- **Every model response is `safeParse`d before use.** One retry, then fail closed with `422 AI_OUTPUT_INVALID`.
- **The Gemini model id comes from `GEMINI_MODEL`**, never a literal in code — free-tier model names change.
- **Money, deletion, event cancellation, role changes and invites have no tool.** The registry's contents are the boundary.
- **shadcn-first.** Prefer an existing `components/ui/` primitive or a native element over a hand-rolled control.
- **Commit style: Conventional Commits.** Scope these `feat(ai)`, `feat(shared)`, `test(ai)`, `docs`.
- **`npm run verify` must pass before the PR** — `typecheck && lint && format:check && test:unit && test:integration && test:e2e`.

---

## File structure

**Created**

| Path                                                  | Responsibility                                                              | Task |
| ----------------------------------------------------- | --------------------------------------------------------------------------- | ---- |
| `backend/src/config/ai.ts`                            | Reads the four env variables. The one place AI is turned off.               | 1    |
| `backend/src/lib/ai/client.ts`                        | `CompletionFn` + `makeGeminiComplete`. Only file importing `@google/genai`. | 1    |
| `backend/src/lib/ai/client.test.ts`                   | Provider unit tests, SDK stubbed.                                           | 1    |
| `shared/src/schemas/ai/ai.ts`                         | Every AI request/response shape.                                            | 3    |
| `shared/src/schemas/ai/ai.test.ts`                    | Schema tests.                                                               | 3    |
| `backend/src/routes/ai/service.ts`                    | Channel, run record, daily cap, JSON extraction and parsing.                | 4    |
| `backend/src/routes/ai/service.test.ts`               | Unit tests. No DB, no network.                                              | 4    |
| `backend/src/routes/ai/handles.ts`                    | Handle issue/resolve; the per-run map.                                      | 5    |
| `backend/src/routes/ai/handles.test.ts`               | Unit tests.                                                                 | 5    |
| `backend/src/routes/ai/tools/read.ts`                 | The eight read tools.                                                       | 5    |
| `backend/src/routes/ai/tools/propose.ts`              | The four proposal tools; they stage, they do not write.                     | 5    |
| `backend/src/routes/ai/tools/registry.ts`             | Tool list, tier filtering, dispatch.                                        | 5    |
| `backend/src/routes/ai/tools/registry.test.ts`        | Unit tests for filtering and dispatch.                                      | 5    |
| `backend/src/routes/ai/prompt.ts`                     | System prompt + tool descriptions + proposal cap.                           | 6    |
| `backend/src/routes/ai/prompt.test.ts`                | Unit tests.                                                                 | 6    |
| `backend/src/routes/ai/ai.ts`                         | The four endpoints. Thin: validate, call service, map typed errors.         | 6–9  |
| `backend/src/routes/ai/ai.integration.test.ts`        | supertest → real app → Docker Postgres, provider stubbed.                   | 6–9  |
| `backend/src/routes/ai/apply.ts`                      | Per-operation gates, ref substitution, one `Tx`.                            | 7    |
| `backend/src/routes/ai/apply.test.ts`                 | Unit tests for gating and ordering.                                         | 7    |
| `frontend/src/components/ai/proposal-card.tsx`        | The card: sections, footer, scroll.                                         | 10   |
| `frontend/src/components/ai/create-task-row.tsx`      | Editable create row for a task.                                             | 10   |
| `frontend/src/components/ai/create-event-row.tsx`     | Editable create row for an event.                                           | 10   |
| `frontend/src/components/ai/diff-row.tsx`             | `before → after` row, after-value editable.                                 | 10   |
| `frontend/src/components/ai/proposal-card.test.tsx`   | Component tests.                                                            | 10   |
| `frontend/src/lib/ai-sections.ts`                     | `(operation, entity)` → section derivation.                                 | 10   |
| `frontend/src/lib/ai-sections.test.ts`                | Unit tests for derivation.                                                  | 10   |
| `frontend/src/hooks/use-assistant.ts`                 | Chat ViewModel: send, stage, apply.                                         | 11   |
| `frontend/src/hooks/use-assistant.test.tsx`           | Hook tests.                                                                 | 11   |
| `frontend/src/hooks/use-briefing.ts`                  | Briefing ViewModel.                                                         | 12   |
| `frontend/src/components/ai/briefing-card.tsx`        | Dashboard card.                                                             | 12   |
| `frontend/src/components/ai/thread-summary-panel.tsx` | Event Thread-tab panel.                                                     | 12   |
| `frontend/src/hooks/use-thread-summary.ts`            | Summary ViewModel.                                                          | 12   |
| `e2e/ai.spec.ts`                                      | E2E with AI off (the default) plus one axe scan.                            | 13   |

**Modified**

| Path                                    | Change                                                   | Task  |
| --------------------------------------- | -------------------------------------------------------- | ----- |
| `package.json` (root + backend)         | Add `@google/genai`                                      | 1     |
| `backend/src/db/schema/ai-run.ts`       | Three nullable counters                                  | 2     |
| `backend/src/db/schema/event.ts`        | `aiRunId` column                                         | 2     |
| `backend/drizzle/`                      | One generated migration                                  | 2     |
| `shared/src/index.ts`                   | Export the `ai` schema barrel                            | 3     |
| `backend/src/routes/index.ts`           | Register `aiRouter`                                      | 6     |
| `backend/src/routes/threads/threads.ts` | Extract `assertCanReadChannel` into `threads/service.ts` | 8     |
| `frontend/src/routes/ai-breakdown.tsx`  | Becomes the assistant chat                               | 11    |
| `frontend/src/routes/dashboard.tsx`     | Briefing card in the right rail                          | 12    |
| `frontend/src/routes/event-detail.tsx`  | "Plan with AI" on Tasks tab; summary panel on Thread tab | 11,12 |
| `docs/api-endpoints.md`                 | Confirm the `## AI` section matches what shipped         | 13    |
| `docs/prd.md`                           | R15 → 🟡                                                 | 13    |

**Already done, do not redo:** `.env.example` and `docs/setup.md` carry the four variables and the Google AI Studio walkthrough.

---

## Task 1: Config, Gemini client, and the `CompletionFn` seam

**Files:**

- Create: `backend/src/config/ai.ts`
- Create: `backend/src/lib/ai/client.ts`
- Create: `backend/src/lib/ai/client.test.ts`
- Modify: `package.json` (root — add the dependency to the backend workspace)

**Interfaces:**

- Consumes: nothing.
- Produces: `type AiConfig = { enabled: boolean; apiKey: string; model: string; dailyRunCap: number }`; `aiConfig(): AiConfig`; `type CompletionFn = (prompt: string) => Promise<string>`; `makeGeminiComplete(config: AiConfig, client?: GenAiLike): CompletionFn`; `geminiComplete: CompletionFn`; `class AiDisabledError`; `class AiQuotaError`.

- [ ] **Step 1: Install the SDK**

```bash
npm install @google/genai --workspace @ctp/backend
```

- [ ] **Step 2: Write the failing test**

Create `backend/src/lib/ai/client.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { AiDisabledError, AiQuotaError, makeGeminiComplete } from "./client.js";

const config = { enabled: true, apiKey: "k", model: "gemini-2.5-flash", dailyRunCap: 50 };

describe("makeGeminiComplete", () => {
  it("throws AiDisabledError when the deployment has AI switched off", async () => {
    const complete = makeGeminiComplete({ ...config, enabled: false });
    await expect(complete("hi")).rejects.toBeInstanceOf(AiDisabledError);
  });

  it("returns the model's text and sends the configured model id", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '{"ok":true}' });
    const complete = makeGeminiComplete(config, { models: { generateContent } });
    await expect(complete("hi")).resolves.toBe('{"ok":true}');
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-2.5-flash", contents: "hi" }),
    );
  });

  it("returns an empty string when the model returns no text", async () => {
    const generateContent = vi.fn().mockResolvedValue({});
    const complete = makeGeminiComplete(config, { models: { generateContent } });
    await expect(complete("hi")).resolves.toBe("");
  });

  it("maps a provider 429 to AiQuotaError", async () => {
    const generateContent = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("quota"), { status: 429 }));
    const complete = makeGeminiComplete(config, { models: { generateContent } });
    await expect(complete("hi")).rejects.toBeInstanceOf(AiQuotaError);
  });

  it("rethrows any other provider failure unchanged", async () => {
    const boom = new Error("network down");
    const generateContent = vi.fn().mockRejectedValue(boom);
    const complete = makeGeminiComplete(config, { models: { generateContent } });
    await expect(complete("hi")).rejects.toBe(boom);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run backend/src/lib/ai/client.test.ts`
Expected: FAIL — `Cannot find module './client.js'`.

- [ ] **Step 4: Write `backend/src/config/ai.ts`**

```typescript
import "./load-env.js";

export type AiConfig = {
  enabled: boolean;
  apiKey: string;
  model: string;
  dailyRunCap: number;
};

/**
 * AI is opt-in per deployment (R14): the assistant sends club data to Google,
 * and AI Studio free-tier prompts may be retained, so the flag defaults to OFF
 * and every environment turns it on deliberately. See docs/setup.md.
 */
export function aiConfig(): AiConfig {
  return {
    enabled: process.env.AI_ENABLED === "1" && Boolean(process.env.GEMINI_API_KEY),
    apiKey: process.env.GEMINI_API_KEY ?? "",
    // Never a literal: free-tier model ids change, and a hard-coded one is an outage.
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    dailyRunCap: Number(process.env.AI_DAILY_RUN_CAP) || 50,
  };
}
```

- [ ] **Step 5: Write `backend/src/lib/ai/client.ts`**

```typescript
import { GoogleGenAI } from "@google/genai";
import { aiConfig, type AiConfig } from "../../config/ai.js";

/**
 * The seam. Services and tools take one of these as a parameter rather than
 * importing a provider, so unit tests pass a fake and `npm run test:unit` never
 * touches the network. Swapping Gemini out is a change to this file only.
 */
export type CompletionFn = (prompt: string) => Promise<string>;

/** 503 — this deployment has the assistant switched off, or has no key. */
export class AiDisabledError extends Error {
  constructor(message = "The assistant is not enabled on this deployment.") {
    super(message);
    this.name = "AiDisabledError";
  }
}

/** 429 — the daily cap is spent, or the provider rate-limited us. */
export class AiQuotaError extends Error {
  constructor(message = "The assistant has hit its usage limit. Try again later.") {
    super(message);
    this.name = "AiQuotaError";
  }
}

/** The slice of the SDK we use, so tests supply a double without the network. */
type GenAiLike = {
  models: {
    generateContent: (args: { model: string; contents: string }) => Promise<{ text?: string }>;
  };
};

export function makeGeminiComplete(config: AiConfig, client?: GenAiLike): CompletionFn {
  return async (prompt: string): Promise<string> => {
    if (!config.enabled) throw new AiDisabledError();
    const genai: GenAiLike = client ?? new GoogleGenAI({ apiKey: config.apiKey });
    try {
      const response = await genai.models.generateContent({
        model: config.model,
        contents: prompt,
      });
      return response.text ?? "";
    } catch (cause) {
      // The free tier rate-limits aggressively; surface that as 429, not 500.
      if (
        typeof cause === "object" &&
        cause !== null &&
        "status" in cause &&
        cause.status === 429
      ) {
        throw new AiQuotaError();
      }
      throw cause;
    }
  };
}

export const geminiComplete: CompletionFn = (prompt) => makeGeminiComplete(aiConfig())(prompt);
```

> **Verify before merging:** confirm `@google/genai`'s call shape against the installed version's README — `ai.models.generateContent({ model, contents })` returning `{ text }` is correct for v2.x. The `GenAiLike` type localises any fix to this one file.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run backend/src/lib/ai/client.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run test:unit
git add backend/src/config/ai.ts backend/src/lib/ai package.json package-lock.json backend/package.json
git commit -m "feat(ai): add Gemini client behind an injectable completion seam"
```

---

## Task 2: The migration — run counters and event provenance

**Files:**

- Modify: `backend/src/db/schema/ai-run.ts`
- Modify: `backend/src/db/schema/event.ts`
- Create: `backend/drizzle/<generated>.sql` (produced by drizzle-kit, never hand-written)

**Interfaces:**

- Consumes: nothing.
- Produces: `aiRuns.proposedCount`, `aiRuns.keptCount`, `aiRuns.editedCount` (all `integer | null`); `events.aiRunId` (`string | null`).

- [ ] **Step 1: Add the counters to `backend/src/db/schema/ai-run.ts`**

Add `integer` to the existing `drizzle-orm/pg-core` import, then add these three columns to the table definition, directly after `costMicroUsd`:

```typescript
    // What the member did with what was proposed, captured from the
    // confirmation they were already making. Null until a card is applied;
    // a run that only answered a question never sets them.
    proposedCount: integer("proposed_count"),
    keptCount: integer("kept_count"),
    editedCount: integer("edited_count"),
```

Add these checks to the table's second argument, alongside `ai_run_cost_non_negative_check`:

```typescript
    check(
      "ai_run_counts_non_negative_check",
      sql`(${table.proposedCount} IS NULL OR ${table.proposedCount} >= 0)
          AND (${table.keptCount} IS NULL OR ${table.keptCount} >= 0)
          AND (${table.editedCount} IS NULL OR ${table.editedCount} >= 0)`,
    ),
    check(
      "ai_run_kept_within_proposed_check",
      sql`${table.keptCount} IS NULL OR ${table.proposedCount} IS NULL
          OR ${table.keptCount} <= ${table.proposedCount}`,
    ),
```

- [ ] **Step 2: Add provenance to `backend/src/db/schema/event.ts`**

Import `aiRuns` from `./ai-run.js` and add the column, mirroring `task.ts:80`:

```typescript
    // Mirrors task.ai_run_id: an assistant-created event carries the same
    // provenance a task does, so /ai's history can show both.
    aiRunId: uuid("ai_run_id").references(() => aiRuns.id, { onDelete: "set null" }),
```

Add `table.aiRunId` to the existing `uuidShape(...)` check in that file's constraint list.

> **Watch for an import cycle:** `ai-run.ts` imports `channels` and `appUsers`, not `events`, so `event.ts → ai-run.ts` is a new edge in one direction only. If `tsc` reports a cycle, the schema barrel ordering in `db/schema/index.ts` is the thing to adjust, not the FK.

- [ ] **Step 3: Generate the migration**

```bash
npm run db:generate
```

Expected: one new `.sql` file in `backend/drizzle/` plus an updated snapshot. Open the SQL and confirm it contains only `ALTER TABLE "ai_run" ADD COLUMN`, `ALTER TABLE "event" ADD COLUMN`, the FK, and the two checks. **If it contains any `DROP`, stop** — the snapshot is out of sync and dropping a column would lose data.

- [ ] **Step 4: Apply it and confirm it runs**

```bash
npm run db:migrate
```

Expected: applies cleanly. Then confirm the columns exist:

```bash
npm run db:studio
```

Check `ai_run` has the three counters and `event` has `ai_run_id`.

- [ ] **Step 5: Confirm the suite still passes against the migrated database**

Run: `npm run test:integration`
Expected: PASS — the existing event and task suites must be unaffected, since every new column is nullable.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/schema/ai-run.ts backend/src/db/schema/event.ts backend/drizzle
git commit -m "feat(ai): record proposal outcomes and event provenance"
```

---

## Task 3: Shared zod schemas

**Files:**

- Create: `shared/src/schemas/ai/ai.ts`
- Create: `shared/src/schemas/ai/ai.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**

- Consumes: `taskPrioritySchema` from `../task/task.js`; `createEventSchema`, `changeEventStatusSchema` from `../event/event.js`.
- Produces: `AI_MAX_PROPOSALS`; `aiHandleSchema`, `aiRefSchema`; `aiProposedTaskSchema`, `aiProposedEventSchema`, `aiTaskDiffSchema`, `aiEventDiffSchema`; `aiProposalSchema` (what the model emits — handles, backend-only); `aiResolvedProposalSchema` (what the client renders — ids plus each diff's `before`); `aiApplyRequestSchema`, `aiApplyResponseSchema`; `aiMessageRequestSchema`, `aiMessageResponseSchema`; `aiBriefingSchema`, `aiBriefingResponseSchema`; `aiThreadSummarySchema`, `aiThreadSummaryResponseSchema`; and the inferred types of each.

**Three proposal shapes, each with one job.** `aiProposalSchema` is the model's
output and uses handles; `aiResolvedProposalSchema` is what the chat endpoint
returns, with handles resolved to ids and each diff carrying its `before`;
`aiApplyRequestSchema` is what the client posts back. Handles never leave the
backend — that is what keeps "the model never emits a UUID" true without making
the card resolve anything.

- [ ] **Step 1: Write the failing test**

Create `shared/src/schemas/ai/ai.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  AI_MAX_PROPOSALS,
  aiApplyRequestSchema,
  aiHandleSchema,
  aiProposalSchema,
  aiRefSchema,
  aiResolvedProposalSchema,
  aiThreadSummarySchema,
} from "./ai.js";

describe("aiHandleSchema", () => {
  it("accepts the handles read tools issue", () => {
    for (const handle of ["T1", "E12", "M300"]) {
      expect(aiHandleSchema.safeParse(handle).success).toBe(true);
    }
  });

  it("rejects a UUID, which the model must never emit", () => {
    const uuid = "0192f1a0-0000-7000-8000-000000000000";
    expect(aiHandleSchema.safeParse(uuid).success).toBe(false);
  });
});

describe("aiRefSchema", () => {
  it("accepts a staged-row ref", () => {
    expect(aiRefSchema.safeParse("$event1").success).toBe(true);
  });

  it("rejects a handle, which names an existing row instead", () => {
    expect(aiRefSchema.safeParse("T1").success).toBe(false);
  });
});

describe("aiProposalSchema", () => {
  const task = { title: "Book venue" };

  it("accepts a plan of one event and its tasks", () => {
    const parsed = aiProposalSchema.safeParse({
      createEvent: {
        ref: "$event1",
        title: "Hackathon 2026",
        startsAt: "2026-10-14T09:00:00.000Z",
      },
      createTasks: [{ ...task, eventRef: "$event1", dueOffsetDays: -21 }],
    });
    expect(parsed.success).toBe(true);
  });

  it("caps a single turn at AI_MAX_PROPOSALS tasks", () => {
    const tasks = Array.from({ length: AI_MAX_PROPOSALS + 1 }, () => task);
    expect(aiProposalSchema.safeParse({ createTasks: tasks }).success).toBe(false);
  });

  it("accepts a reassignment as a task diff", () => {
    const parsed = aiProposalSchema.safeParse({
      updateTasks: [{ handle: "T7", assigneeHandles: ["M2"] }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an event status of cancelled — cancellation has one door", () => {
    const parsed = aiProposalSchema.safeParse({
      updateEvent: { handle: "E1", status: "cancelled" },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("aiResolvedProposalSchema", () => {
  const id = "0192f1a0-0000-7000-8000-000000000000";

  it("carries an id and each diff's before value, so a card can render before → after", () => {
    const parsed = aiResolvedProposalSchema.safeParse({
      updateTasks: [
        {
          id,
          title: "Print name badges",
          diffs: [{ field: "assignees", before: "Ben Ng", after: "Aisha K" }],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a handle where an id belongs — handles never leave the backend", () => {
    const parsed = aiResolvedProposalSchema.safeParse({
      updateTasks: [
        { id: "T7", title: "x", diffs: [{ field: "priority", before: "low", after: "high" }] },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("aiApplyRequestSchema", () => {
  it("requires at least one operation", () => {
    const parsed = aiApplyRequestSchema.safeParse({
      runId: "0192f1a0-0000-7000-8000-000000000000",
      operations: [],
      stats: { proposed: 0, kept: 0, edited: 0 },
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a create bound to a staged event", () => {
    const parsed = aiApplyRequestSchema.safeParse({
      runId: "0192f1a0-0000-7000-8000-000000000000",
      operations: [
        {
          op: "create",
          entity: "event",
          ref: "$event1",
          data: { title: "H", startsAt: "2026-10-14T09:00:00.000Z" },
        },
        { op: "create", entity: "task", data: { title: "Book venue", eventRef: "$event1" } },
      ],
      stats: { proposed: 2, kept: 2, edited: 0 },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("aiThreadSummarySchema", () => {
  it("accepts bullets with an unassigned action item", () => {
    const parsed = aiThreadSummarySchema.safeParse({
      summary: ["Venue is booked."],
      actionItems: [{ text: "Chase catering", suggestedAssigneeName: null }],
    });
    expect(parsed.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run shared/src/schemas/ai/ai.test.ts`
Expected: FAIL — `Cannot find module './ai.js'`.

- [ ] **Step 3: Write `shared/src/schemas/ai/ai.ts`**

```typescript
import { z } from "zod";
import { changeEventStatusSchema, createEventSchema } from "../event/event.js";
import { taskPrioritySchema } from "../task/task.js";

/**
 * One assistant turn stages at most this many proposals. Enforced twice — as a
 * prompt constraint and here — so a card always fits a review a person will
 * actually do. Longer plans are a conversation.
 */
export const AI_MAX_PROPOSALS = 30;

/**
 * A HANDLE names a row that already exists, issued by a read tool earlier in
 * this run (`T` task, `E` event, `M` member). The model emits these instead of
 * UUIDs, so a hallucinated identifier cannot reach a query — the server
 * resolves handles against the run's own map.
 */
export const aiHandleSchema = z
  .string()
  .regex(/^[TEM][1-9][0-9]{0,2}$/u, "Expected a handle like T1, E2 or M3");

/**
 * A REF names a row staged in this same card, which has no id yet — a task can
 * be bound to the event being created alongside it.
 */
export const aiRefSchema = z
  .string()
  .regex(/^\$[a-z][a-z0-9]{0,23}$/u, "Expected a ref like $event1");

const titleSchema = z.string().trim().min(1, "A title is required").max(200);
const descriptionSchema = z.string().trim().max(2000).optional();

/** What the model proposes for a NEW task. Dates are offsets (D14), never absolute. */
export const aiProposedTaskSchema = z.object({
  title: titleSchema,
  description: descriptionSchema,
  priority: taskPrioritySchema.default("medium"),
  /** Days relative to the event's `startsAt`; negative is before it. */
  dueOffsetDays: z.number().int().min(-365).max(365).optional(),
  assigneeHandles: z.array(aiHandleSchema).max(10).default([]),
  /** Exactly one of these, or neither for a standalone task. */
  eventRef: aiRefSchema.optional(),
  eventHandle: aiHandleSchema.optional(),
});
export type AiProposedTask = z.infer<typeof aiProposedTaskSchema>;

/** What the model proposes for a NEW event. `allocationCents` is absent by design (Rule 13). */
export const aiProposedEventSchema = createEventSchema
  .pick({ title: true, description: true, venue: true, startsAt: true, endsAt: true })
  .extend({ ref: aiRefSchema });
export type AiProposedEvent = z.infer<typeof aiProposedEventSchema>;

/** A change to an existing task. At least one field beyond the handle. */
export const aiTaskDiffSchema = z
  .object({
    handle: aiHandleSchema,
    title: titleSchema.optional(),
    description: descriptionSchema,
    priority: taskPrioritySchema.optional(),
    dueAt: z.coerce.date().nullish(),
    assigneeHandles: z.array(aiHandleSchema).max(10).optional(),
  })
  .refine((diff) => Object.keys(diff).length > 1, {
    message: "Provide at least one field to change",
  });
export type AiTaskDiff = z.infer<typeof aiTaskDiffSchema>;

/**
 * A change to an existing event. `status` reuses `changeEventStatusSchema`'s
 * enum, so the values the assistant can propose are exactly the ones tier 1 may
 * set through `PATCH /api/events/:id/status`.
 */
export const aiEventDiffSchema = z
  .object({
    handle: aiHandleSchema,
    title: titleSchema.optional(),
    description: descriptionSchema,
    venue: z.string().trim().max(200).nullish(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().nullish(),
    status: changeEventStatusSchema.shape.status.optional(),
  })
  .refine((diff) => Object.keys(diff).length > 1, {
    message: "Provide at least one field to change",
  });
export type AiEventDiff = z.infer<typeof aiEventDiffSchema>;

/** Everything one assistant turn may stage. Every field optional; an answer stages nothing. */
export const aiProposalSchema = z
  .object({
    createEvent: aiProposedEventSchema.optional(),
    createTasks: z.array(aiProposedTaskSchema).max(AI_MAX_PROPOSALS).optional(),
    updateTasks: z.array(aiTaskDiffSchema).max(AI_MAX_PROPOSALS).optional(),
    updateEvent: aiEventDiffSchema.optional(),
  })
  .refine(
    (proposal) =>
      (proposal.createTasks?.length ?? 0) + (proposal.updateTasks?.length ?? 0) <= AI_MAX_PROPOSALS,
    { message: `A single turn may stage at most ${AI_MAX_PROPOSALS} proposals` },
  );
export type AiProposal = z.infer<typeof aiProposalSchema>;

// ── What the client renders ──────────────────────────────────────────────────

/**
 * Handles are resolved to ids at the response boundary, so they never leave the
 * backend: the model still emits no UUID, and the card works in ids like every
 * other form in the app. A diff row also needs the CURRENT value to render
 * `before → after`, and only the server can supply that.
 */
const resolvedFieldDiffSchema = z.object({
  field: z.string().min(1),
  /** Rendered as immutable text. Null means the field was unset. */
  before: z.string().nullable(),
  after: z.string().nullable(),
});
export type ResolvedFieldDiff = z.infer<typeof resolvedFieldDiffSchema>;

const resolvedUpdateSchema = z.object({
  id: z.uuid(),
  /** The row's current title, so the card can label the diff. */
  title: z.string().min(1),
  diffs: z.array(resolvedFieldDiffSchema).min(1),
});

/** `dueOffsetDays` has become an absolute `dueAt`, computed server-side in CLUB_TIMEZONE (D14). */
const resolvedCreateTaskSchema = z.object({
  title: titleSchema,
  description: descriptionSchema,
  priority: taskPrioritySchema,
  dueAt: z.coerce.date().nullable(),
  assignees: z.array(z.object({ id: z.uuid(), name: z.string() })),
  eventRef: aiRefSchema.optional(),
  eventId: z.uuid().optional(),
});

export const aiResolvedProposalSchema = z.object({
  createEvent: aiProposedEventSchema.optional(),
  createTasks: z.array(resolvedCreateTaskSchema).max(AI_MAX_PROPOSALS).optional(),
  updateTasks: z.array(resolvedUpdateSchema).max(AI_MAX_PROPOSALS).optional(),
  updateEvent: resolvedUpdateSchema.optional(),
});
export type AiResolvedProposal = z.infer<typeof aiResolvedProposalSchema>;

// ── POST /api/ai/messages ────────────────────────────────────────────────────

export const aiMessageRequestSchema = z.object({
  text: z.string().trim().min(1, "Say something").max(4000),
  /** Optional starting context from whichever surface opened the chat. */
  seed: z.object({ eventId: z.uuid().optional() }).optional(),
});
export type AiMessageRequest = z.infer<typeof aiMessageRequestSchema>;

export const aiMessageResponseSchema = z.object({
  runId: z.uuid(),
  reply: z.string(),
  /** Resolved, not raw: the client never sees a handle. */
  proposal: aiResolvedProposalSchema.nullable(),
});
export type AiMessageResponse = z.infer<typeof aiMessageResponseSchema>;

// ── POST /api/ai/proposals/apply ─────────────────────────────────────────────

/**
 * The EDITED card. By this point it is an ordinary form submission that happens
 * to carry AI provenance, so it is re-validated here and re-authorised per
 * operation on the server.
 */
const applyOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    entity: z.literal("event"),
    ref: aiRefSchema,
    data: createEventSchema.omit({ allocationCents: true, teamId: true }),
  }),
  z.object({
    op: z.literal("create"),
    entity: z.literal("task"),
    data: z.object({
      title: titleSchema,
      description: descriptionSchema,
      priority: taskPrioritySchema.default("medium"),
      dueAt: z.coerce.date().nullish(),
      assigneeIds: z.array(z.uuid()).max(10).default([]),
      eventId: z.uuid().optional(),
      eventRef: aiRefSchema.optional(),
    }),
  }),
  z.object({
    op: z.literal("update"),
    entity: z.literal("task"),
    id: z.uuid(),
    data: z.object({
      title: titleSchema.optional(),
      description: descriptionSchema,
      priority: taskPrioritySchema.optional(),
      dueAt: z.coerce.date().nullish(),
      assigneeIds: z.array(z.uuid()).max(10).optional(),
    }),
  }),
  z.object({
    op: z.literal("update"),
    entity: z.literal("event"),
    id: z.uuid(),
    data: z.object({
      title: titleSchema.optional(),
      description: descriptionSchema,
      venue: z.string().trim().max(200).nullish(),
      startsAt: z.coerce.date().optional(),
      endsAt: z.coerce.date().nullish(),
      status: changeEventStatusSchema.shape.status.optional(),
    }),
  }),
]);
export type AiApplyOperation = z.infer<typeof applyOperationSchema>;

export const aiApplyRequestSchema = z.object({
  runId: z.uuid(),
  operations: z
    .array(applyOperationSchema)
    .min(1, "Nothing was selected")
    .max(AI_MAX_PROPOSALS + 1),
  /** Evaluation data, written to ai_run. The client is where the edit state lives. */
  stats: z.object({
    proposed: z.number().int().nonnegative(),
    kept: z.number().int().nonnegative(),
    edited: z.number().int().nonnegative(),
  }),
});
export type AiApplyRequest = z.infer<typeof aiApplyRequestSchema>;

export const aiApplyResponseSchema = z.object({
  events: z.array(z.object({ id: z.uuid(), title: z.string() })),
  tasks: z.array(z.object({ id: z.uuid(), title: z.string() })),
});
export type AiApplyResponse = z.infer<typeof aiApplyResponseSchema>;

// ── GET /api/ai/briefing ─────────────────────────────────────────────────────

export const aiBriefingSchema = z.object({
  summary: z.string().min(1),
  bullets: z.array(z.string().min(1)).max(4),
});
export type AiBriefing = z.infer<typeof aiBriefingSchema>;

export const aiBriefingResponseSchema = z.object({
  briefing: aiBriefingSchema,
  generatedAt: z.iso.datetime(),
});
export type AiBriefingResponse = z.infer<typeof aiBriefingResponseSchema>;

// ── POST /api/ai/threads/:id/summary ─────────────────────────────────────────

export const aiThreadSummarySchema = z.object({
  summary: z.array(z.string().min(1)).min(1).max(5),
  actionItems: z
    .array(
      z.object({
        text: z.string().min(1).max(200),
        suggestedAssigneeName: z.string().max(120).nullable(),
      }),
    )
    .max(10),
});
export type AiThreadSummary = z.infer<typeof aiThreadSummarySchema>;

export const aiThreadSummaryResponseSchema = z.object({
  summary: aiThreadSummarySchema,
  asOfMessageId: z.uuid(),
});
export type AiThreadSummaryResponse = z.infer<typeof aiThreadSummaryResponseSchema>;
```

- [ ] **Step 4: Export the barrel**

Append to `shared/src/index.ts`, alongside the other schema exports:

```typescript
export * from "./schemas/ai/ai.js";
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run shared/src/schemas/ai/ai.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run test:unit
git add shared/src/schemas/ai shared/src/index.ts
git commit -m "feat(shared): add assistant request and proposal schemas"
```

---

## Task 4: AI service foundations — channel, run record, daily cap, JSON parsing

**Files:**

- Create: `backend/src/routes/ai/service.ts`
- Create: `backend/src/routes/ai/service.test.ts`

**Interfaces:**

- Consumes: `CompletionFn`, `AiQuotaError` from Task 1; `getDb()`, `newId()`; `aiRuns`, `channels`, `chanMembers` from `../../db/schema/index.js`.
- Produces: `type Tx`, `type Queryable`, `class AiOutputError`, `extractJson(raw: string): string`, `completeJson<T extends z.ZodTypeAny>(complete, prompt, schema): Promise<z.infer<T>>`, `resolveAiChannel(tx: Tx, userId: string): Promise<string>`, `assertUnderDailyCap(db: Queryable, userId: string, cap: number): Promise<void>`, `type RunStep`, `recordRun(tx: Tx, args: { userId: string; prompt: string; steps: RunStep[] }): Promise<string>`, `recordRunOutcome(db: Queryable, runId: string, stats: { proposed: number; kept: number; edited: number }): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/ai/service.test.ts`:

````typescript
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiOutputError, completeJson, extractJson } from "./service.js";

const schema = z.object({ ok: z.boolean() });

describe("extractJson", () => {
  it("passes bare JSON through", () => {
    expect(extractJson('{"ok":true}')).toBe('{"ok":true}');
  });

  it("unwraps a fenced block, which Gemini emits even when asked not to", () => {
    expect(extractJson('```json\n{"ok":true}\n```')).toBe('{"ok":true}');
  });

  it("unwraps an unlabelled fence", () => {
    expect(extractJson('```\n{"ok":true}\n```')).toBe('{"ok":true}');
  });

  it("strips prose before the object", () => {
    expect(extractJson('Sure! Here you go:\n{"ok":true}')).toBe('{"ok":true}');
  });
});

describe("completeJson", () => {
  it("returns the parsed value on the first attempt", async () => {
    const complete = vi.fn().mockResolvedValue('{"ok":true}');
    await expect(completeJson(complete, "p", schema)).resolves.toEqual({ ok: true });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("retries once when the first response does not satisfy the schema", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce('{"ok":false}');
    await expect(completeJson(complete, "p", schema)).resolves.toEqual({ ok: false });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("fails closed after two bad responses, so a partial write is impossible", async () => {
    const complete = vi.fn().mockResolvedValue("still not json");
    await expect(completeJson(complete, "p", schema)).rejects.toBeInstanceOf(AiOutputError);
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
````

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run backend/src/routes/ai/service.test.ts`
Expected: FAIL — `Cannot find module './service.js'`.

- [ ] **Step 3: Write `backend/src/routes/ai/service.ts`**

````typescript
import { and, count, eq, gt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { z } from "zod";
import { newId } from "../../db/id.js";
import type * as schema from "../../db/schema/index.js";
import { aiRuns, chanMembers, channels } from "../../db/schema/index.js";
import { AiQuotaError, type CompletionFn } from "../../lib/ai/client.js";

/** Same derivation as routes/events/service.ts, so it cannot drift from Drizzle. */
export type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0];
export type Queryable = Tx | NodePgDatabase<typeof schema>;

/** 422 — the model produced something that is not our schema, twice. */
export class AiOutputError extends Error {
  constructor(message = "The assistant returned something unusable. Try rephrasing.") {
    super(message);
    this.name = "AiOutputError";
  }
}

/**
 * Models wrap JSON in markdown fences no matter how firmly the prompt says
 * otherwise, and sometimes prefix it with a sentence. Strip both before parsing
 * rather than burning a retry on a response that was actually correct.
 */
export function extractJson(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(raw);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

/**
 * The one place model output becomes typed data. Two attempts, then fail
 * closed: a 422 the member can act on beats a half-applied guess.
 */
export async function completeJson<T extends z.ZodTypeAny>(
  complete: CompletionFn,
  prompt: string,
  outputSchema: T,
): Promise<z.infer<T>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await complete(prompt);
    try {
      const parsed = outputSchema.safeParse(JSON.parse(extractJson(raw)));
      if (parsed.success) return parsed.data;
    } catch {
      // JSON.parse threw — fall through to the retry.
    }
  }
  throw new AiOutputError();
}

/**
 * `ai_run.channel_id` is NOT NULL, and channel.ts says the assistant "is
 * kind = 'ai', a dedicated PAGE" — so each member gets exactly one, made on
 * first use. Three CHECK constraints apply: the name must be non-blank,
 * min_tier must stay 0, and both parents must be NULL.
 */
export async function resolveAiChannel(tx: Tx, userId: string): Promise<string> {
  const [existing] = await tx
    .select({ id: channels.id })
    .from(channels)
    .innerJoin(chanMembers, eq(chanMembers.channelId, channels.id))
    .where(and(eq(channels.kind, "ai"), eq(chanMembers.userId, userId)))
    .limit(1);
  if (existing) return existing.id;

  const channelId = newId();
  await tx.insert(channels).values({ id: channelId, kind: "ai", name: "Assistant" });
  await tx.insert(chanMembers).values({ channelId, userId });
  return channelId;
}

/**
 * The free tier has one shared quota, so one member running the planner in a
 * loop would spend the club's day. Counted off ai_run — no extra table.
 */
export async function assertUnderDailyCap(
  db: Queryable,
  userId: string,
  cap: number,
): Promise<void> {
  const [row] = await db
    .select({ runs: count() })
    .from(aiRuns)
    .where(and(eq(aiRuns.userId, userId), gt(aiRuns.createdAt, sql`now() - interval '24 hours'`)));
  if ((row?.runs ?? 0) >= cap) throw new AiQuotaError();
}

export type RunStep = { tool: string; ms: number; detail?: Record<string, string | number> };

/**
 * The audit row. `cost_micro_usd` is 0 because the Gemini free tier is free —
 * the column stays for the day the club moves to a paid provider.
 */
export async function recordRun(
  tx: Tx,
  args: { userId: string; prompt: string; steps: RunStep[] },
): Promise<string> {
  const channelId = await resolveAiChannel(tx, args.userId);
  const id = newId();
  await tx.insert(aiRuns).values({
    id,
    channelId,
    userId: args.userId,
    prompt: args.prompt,
    steps: args.steps,
    costMicroUsd: 0,
  });
  return id;
}

/** Written when a card is applied (D16). A run that only answered leaves these null. */
export async function recordRunOutcome(
  db: Queryable,
  runId: string,
  stats: { proposed: number; kept: number; edited: number },
): Promise<void> {
  await db
    .update(aiRuns)
    .set({ proposedCount: stats.proposed, keptCount: stats.kept, editedCount: stats.edited })
    .where(eq(aiRuns.id, runId));
}
````

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run backend/src/routes/ai/service.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run test:unit
git add backend/src/routes/ai
git commit -m "feat(ai): add run recording, daily cap and strict JSON parsing"
```

---

## Task 5: Handles and the tool surface

**Files:**

- Create: `backend/src/routes/ai/handles.ts`
- Create: `backend/src/routes/ai/handles.test.ts`
- Create: `backend/src/routes/ai/tools/read.ts`
- Create: `backend/src/routes/ai/tools/propose.ts`
- Create: `backend/src/routes/ai/tools/registry.ts`
- Create: `backend/src/routes/ai/tools/registry.test.ts`
- Create: `backend/src/routes/threads/service.ts` (extract `assertCanReadChannel`)
- Modify: `backend/src/routes/threads/threads.ts`

**Interfaces:**

- Consumes: Task 4's `Tx`, `Queryable`, `AiOutputError`; `AiProposal` from `@ctp/shared`.
- Produces: `class HandleMap` with `issue(kind: "T" | "E" | "M", id: string): string`, `resolve(handle: string): string` (throws `AiOutputError` on an unissued handle), `toJSON(): Record<string, string>`, `static from(map: Record<string, string>): HandleMap`; `type ToolContext = { db: Queryable; userId: string; tier: number; handles: HandleMap; staged: AiProposal }`; `type Tool = { name: string; minTier: number; describe: string; run(ctx: ToolContext, args: Record<string, unknown>): Promise<unknown> }`; `READ_TOOLS: Tool[]`; `PROPOSE_TOOLS: Tool[]`; `toolsFor(tier: number): Tool[]`; `runTool(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<unknown>`.

- [ ] **Step 1: Write the failing handle test**

Create `backend/src/routes/ai/handles.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { HandleMap } from "./handles.js";
import { AiOutputError } from "./service.js";

const uuid = (n: number) => `0192f1a0-0000-7000-8000-00000000000${n}`;

describe("HandleMap", () => {
  it("issues sequential handles per kind", () => {
    const map = new HandleMap();
    expect(map.issue("T", uuid(1))).toBe("T1");
    expect(map.issue("T", uuid(2))).toBe("T2");
    expect(map.issue("E", uuid(3))).toBe("E1");
  });

  it("reuses the handle already issued for a row", () => {
    const map = new HandleMap();
    expect(map.issue("T", uuid(1))).toBe("T1");
    expect(map.issue("T", uuid(1))).toBe("T1");
  });

  it("resolves an issued handle back to its id", () => {
    const map = new HandleMap();
    const handle = map.issue("E", uuid(4));
    expect(map.resolve(handle)).toBe(uuid(4));
  });

  it("rejects a handle this run never issued", () => {
    expect(() => new HandleMap().resolve("T9")).toThrow(AiOutputError);
  });

  it("round-trips through JSON so it can live in ai_run.steps", () => {
    const map = new HandleMap();
    const handle = map.issue("M", uuid(5));
    expect(HandleMap.from(map.toJSON()).resolve(handle)).toBe(uuid(5));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run backend/src/routes/ai/handles.test.ts`
Expected: FAIL — `Cannot find module './handles.js'`.

- [ ] **Step 3: Write `backend/src/routes/ai/handles.ts`**

```typescript
import { AiOutputError } from "./service.js";

export type HandleKind = "T" | "E" | "M";

/**
 * The rule that makes a hallucinated identifier impossible: the model never
 * sees a UUID. Read tools hand it `T1`, `E2`, `M3`, and only a handle this run
 * actually issued resolves back to a row. Persisted into `ai_run.steps`, so a
 * later apply in the same run can still resolve what the model was shown.
 */
export class HandleMap {
  readonly #byHandle = new Map<string, string>();
  readonly #byId = new Map<string, string>();
  readonly #counts: Record<HandleKind, number> = { T: 0, E: 0, M: 0 };

  issue(kind: HandleKind, id: string): string {
    const existing = this.#byId.get(id);
    if (existing) return existing;
    this.#counts[kind] += 1;
    const handle = `${kind}${this.#counts[kind]}`;
    this.#byHandle.set(handle, id);
    this.#byId.set(id, handle);
    return handle;
  }

  resolve(handle: string): string {
    const id = this.#byHandle.get(handle);
    if (!id) throw new AiOutputError(`The assistant referred to ${handle}, which does not exist.`);
    return id;
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries(this.#byHandle);
  }

  static from(map: Record<string, string>): HandleMap {
    const restored = new HandleMap();
    for (const [handle, id] of Object.entries(map)) {
      const kind = handle[0] as HandleKind;
      restored.#byHandle.set(handle, id);
      restored.#byId.set(id, handle);
      restored.#counts[kind] = Math.max(restored.#counts[kind], Number(handle.slice(1)) || 0);
    }
    return restored;
  }
}
```

- [ ] **Step 4: Run the handle tests and confirm they pass**

Run: `npx vitest run backend/src/routes/ai/handles.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 4b: Extract the channel-visibility check**

`readThread` (next step) must gate on the same rule the threads route uses, so
extract it before writing the tool that needs it.

Move the channel-visibility logic currently inline in
`backend/src/routes/threads/threads.ts` into a new
`backend/src/routes/threads/service.ts` as:

```typescript
export async function assertCanReadChannel(
  db: Queryable,
  channelId: string,
  user: { id: string; tier: number },
): Promise<void>;
```

Import it back into `threads.ts` so there is **one** implementation. Behaviour
must not change — a member must not be able to read through the assistant what
they cannot read through the threads route.

Run: `npm run test:integration -- --run src/routes/threads`
Expected: PASS, unchanged. That is the check that the extraction was faithful.

- [ ] **Step 5: Write the read tools**

Create `backend/src/routes/ai/tools/read.ts`. Each tool returns plain rows
carrying handles, never UUIDs, and reads exactly what the caller could read
through the equivalent route. `listTasks` is the worked example — the other
seven follow its shape:

```typescript
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { appUsers, events, tasks } from "../../../db/schema/index.js";
import type { Tool, ToolContext } from "./registry.js";

/**
 * The planning corpus size. `event` has a `status` and no type or category
 * column, so recency is the ordering available — if a type column is added
 * later, narrowing the corpus by it is a change to this file alone.
 */
export const PLAN_CORPUS_EVENTS = 5;

/** Nothing the assistant reads is unbounded; a free-tier prompt has to fit. */
const READ_LIMIT = 50;

export const listTasks: Tool = {
  name: "listTasks",
  minTier: 0,
  describe:
    "List club tasks. Args: status (todo|in_progress|blocked|done), priority, eventHandle, assigneeHandle. Returns each task with a handle you must use to refer to it.",
  async run(ctx: ToolContext, args): Promise<unknown> {
    const where = [];
    if (typeof args.status === "string") where.push(eq(tasks.status, args.status));
    if (typeof args.eventHandle === "string") {
      where.push(eq(tasks.eventId, ctx.handles.resolve(args.eventHandle)));
    }
    const rows = await ctx.db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueAt: tasks.dueAt,
        eventId: tasks.eventId,
      })
      .from(tasks)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(tasks.createdAt))
      .limit(READ_LIMIT);

    // The id never leaves this function. The model only ever sees the handle.
    return rows.map((row) => ({
      handle: ctx.handles.issue("T", row.id),
      title: row.title,
      status: row.status,
      priority: row.priority,
      dueAt: row.dueAt?.toISOString() ?? null,
      eventHandle: row.eventId ? ctx.handles.issue("E", row.eventId) : null,
    }));
  },
};
```

Then the remaining seven from spec §4.1: `listOverdueTasks` (reuse the
`due_at < now() AND status <> 'done'` predicate the overdue route uses),
`listEvents`, `getEventProgress`, `listMembers`, `pastEventPlans`, `readThread`,
`readBudget`.

Two carry rules worth stating in a comment where they live:

```typescript
/**
 * Committee load, which is what Smart-assign runs on. The open-task count per
 * member is the same figure the dashboard's Committee Load widget shows, so the
 * assistant and the dashboard cannot disagree about who is busy.
 */
```

`readThread` must call `assertCanReadChannel` (extracted in Task 8) rather than
selecting messages directly — a member must not summarise, or ask about, a
channel they cannot open. `readBudget` reads and returns figures; there is no
matching write tool, which is Rule 13.

- [ ] **Step 5b: Write the proposal tools**

Create `backend/src/routes/ai/tools/propose.ts`. These **stage into
`ctx.staged` and write nothing** — a proposal becomes a row only when a person
confirms the card and Task 7's apply endpoint runs.

```typescript
import { aiProposedEventSchema, aiProposedTaskSchema, AI_MAX_PROPOSALS } from "@ctp/shared";
import type { Tool, ToolContext } from "./registry.js";

/**
 * Staging, not writing. The tool's whole effect is to put rows on the card the
 * member is about to read; nothing reaches the database until they confirm it.
 * The tier here mirrors POST /api/events, and Task 7 re-checks it at apply
 * time — this one only keeps the assistant from proposing what the member
 * could not then approve.
 */
export const proposeCreateEvent: Tool = {
  name: "proposeCreateEvent",
  minTier: 1,
  describe:
    "Stage ONE new event for the member to review. Give it a ref like $event1 so tasks can be attached to it.",
  async run(ctx: ToolContext, args): Promise<unknown> {
    const parsed = aiProposedEventSchema.safeParse(args);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid event" };
    ctx.staged.createEvent = parsed.data;
    return { staged: "event", ref: parsed.data.ref };
  },
};
```

`proposeUpdateTasks` (`minTier: 0`) and `proposeUpdateEvent` (`minTier: 1`)
follow the same shape against their schemas from Task 3.

`proposeCreateTasks` is `minTier: 0` but carries one extra rule, because the
apply gate it mirrors is not flat — `POST /api/tasks` is tier 0 and
`POST /api/tasks/bulk` is tier 1:

```typescript
/**
 * A tier-0 officer may create ONE task by hand, so the assistant may stage one
 * for them and no more. Without this the model would happily draft eight and
 * the member would meet a 403 at the moment they clicked Create — the tier
 * filter exists precisely so that cannot happen.
 */
const limit = ctx.tier >= 1 ? AI_MAX_PROPOSALS : 1;
```

It appends to `ctx.staged.createTasks` and returns an error once the combined
count would exceed `limit`.

- [ ] **Step 6: Write the failing registry test**

Create `backend/src/routes/ai/tools/registry.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { HandleMap } from "../handles.js";
import { runTool, toolsFor } from "./registry.js";

const ctx = () => ({
  db: {} as never,
  userId: "0192f1a0-0000-7000-8000-000000000001",
  tier: 0,
  handles: new HandleMap(),
});

describe("toolsFor", () => {
  it("offers every read tool at tier 0", () => {
    expect(toolsFor(0).map((tool) => tool.name)).toContain("listTasks");
  });

  it("offers strictly more at tier 1 than at tier 0", () => {
    expect(toolsFor(1).length).toBeGreaterThanOrEqual(toolsFor(0).length);
  });

  it("never offers a tool that writes", () => {
    for (const tier of [0, 1, 2]) {
      const names = toolsFor(tier).map((tool) => tool.name);
      expect(names).not.toContain("createExpense");
      expect(names).not.toContain("deleteTask");
      expect(names).not.toContain("cancelEvent");
    }
  });
});

describe("runTool", () => {
  it("returns a refusal to the model rather than throwing, when the tier is short", async () => {
    const result = await runTool({ ...ctx(), tier: 0 }, "proposeCreateEvent", {});
    expect(JSON.stringify(result)).toMatch(/permission/iu);
  });

  it("returns a refusal for a tool name that does not exist", async () => {
    const result = await runTool(ctx(), "nonsenseTool", {});
    expect(JSON.stringify(result)).toMatch(/unknown/iu);
  });
});
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `npx vitest run backend/src/routes/ai/tools/registry.test.ts`
Expected: FAIL — `Cannot find module './registry.js'`.

- [ ] **Step 8: Write `backend/src/routes/ai/tools/registry.ts`**

It must export the `Tool` and `ToolContext` types, `READ_TOOLS`, `PROPOSE_TOOLS`, `toolsFor(tier)` filtering `[...READ_TOOLS, ...PROPOSE_TOOLS]` on each tool's `minTier`, and `runTool(ctx, name, args)` which:

1. looks the tool up by name; an unknown name returns `{ error: "Unknown tool" }`;
2. compares `tool.minTier` to `ctx.tier`; short of it, returns
   `{ error: "You do not have permission to do that." }`;
3. otherwise awaits `tool.run(ctx, args)` and returns the result.

Both refusals **return a value, they do not throw**. A tool the caller may not
use is something the assistant should explain in its reply, not a 500.

- [ ] **Step 9: Run the tests and confirm they pass**

Run: `npx vitest run backend/src/routes/ai/handles.test.ts backend/src/routes/ai/tools/registry.test.ts`
Expected: PASS.

- [ ] **Step 10: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run test:unit
git add backend/src/routes/ai
git commit -m "feat(ai): add per-run handles and the read-tool registry"
```

---

## Task 6: The prompt and the chat endpoint

**Files:**

- Create: `backend/src/routes/ai/prompt.ts`
- Create: `backend/src/routes/ai/prompt.test.ts`
- Create: `backend/src/routes/ai/ai.ts`
- Create: `backend/src/routes/ai/ai.integration.test.ts`
- Modify: `backend/src/routes/index.ts`

**Interfaces:**

- Consumes: Tasks 3, 4, 5; `aiMessageRequestSchema`, `aiMessageResponseSchema`, `aiProposalSchema`, `AI_MAX_PROPOSALS` from `@ctp/shared`.
- Produces: `buildSystemPrompt(tools: ReadTool[], context: string): string`; `aiRouter`; `POST /api/ai/messages`.

- [ ] **Step 1: Write the failing prompt test**

Create `backend/src/routes/ai/prompt.test.ts`:

```typescript
import { AI_MAX_PROPOSALS } from "@ctp/shared";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt.js";

const tools = [{ name: "listTasks", minTier: 0, describe: "List tasks", run: async () => [] }];

describe("buildSystemPrompt", () => {
  it("names every tool the caller is allowed to use", () => {
    expect(buildSystemPrompt(tools, "")).toContain("listTasks");
  });

  it("states the proposal cap, so the model does not draft a card nobody will read", () => {
    expect(buildSystemPrompt(tools, "")).toContain(String(AI_MAX_PROPOSALS));
  });

  it("tells the model to use handles rather than identifiers", () => {
    expect(buildSystemPrompt(tools, "")).toMatch(/handle/iu);
  });

  it("carries the seeded context into the prompt", () => {
    expect(buildSystemPrompt(tools, "Event: Hackathon 2026")).toContain("Hackathon 2026");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run backend/src/routes/ai/prompt.test.ts`
Expected: FAIL — `Cannot find module './prompt.js'`.

- [ ] **Step 3: Write `backend/src/routes/ai/prompt.ts`**

```typescript
import { AI_MAX_PROPOSALS } from "@ctp/shared";
import type { Tool } from "./tools/registry.js";

/**
 * The tool list is built from what the CALLER may use, so a member is never
 * offered work they could not then approve. The handle rule is the load-bearing
 * line: it is why a hallucinated identifier cannot reach a query.
 */
export function buildSystemPrompt(tools: Tool[], context: string): string {
  return [
    "You are the committee assistant for the Monash Association of Coding, a university club.",
    "You help members find work, plan events and balance workload. Be brief and concrete.",
    "",
    "TOOLS you may call:",
    ...tools.map((tool) => `- ${tool.name}: ${tool.describe}`),
    "",
    "RULES:",
    "- Refer to every existing task, event or member by the handle a tool gave you (T1, E2, M3).",
    "  Never invent a handle, and never write an id of any other form.",
    "- Use a ref like $event1 for an event you are proposing in this same turn.",
    "- Due dates on NEW tasks are dueOffsetDays, whole days relative to the event's start.",
    "  Negative is before it. Do not compute calendar dates yourself.",
    `- Stage at most ${AI_MAX_PROPOSALS} proposals in one turn. If more work is needed, say so and ask.`,
    "- Propose; never claim you have created anything. A person confirms every change.",
    "",
    "REPLY with ONE JSON object and nothing else. No markdown, no commentary:",
    '{"tool": {"name": "listTasks", "args": {}}}   to call a tool, or',
    '{"reply": "what you want to say to the member"}   when you are done.',
    "",
    context ? `CONTEXT:\n${context}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
```

- [ ] **Step 4: Write `backend/src/routes/ai/ai.ts` with the chat endpoint**

The handler, in order:

1. `authenticate`, `authorise(0)`, `validate(aiMessageRequestSchema, "body")`.
2. Read `aiConfig()`; when `enabled` is false, respond `503 AI_DISABLED`.
3. `assertUnderDailyCap(db, userId, config.dailyRunCap)`.
4. Build `ToolContext` with a fresh `HandleMap` and the caller's tier.
5. Run the tool loop: at most `MAX_TOOL_STEPS = 6` iterations. Each iteration
   completes the prompt, parses the model's reply, and either runs the tool it
   asked for (appending a `RunStep`) or finishes with a reply plus an optional
   proposal parsed by `aiProposalSchema`.
6. **Resolve the staged proposal before responding.** Map `ctx.staged`
   (`AiProposal`, handles) to an `AiResolvedProposal`: `handles.resolve()` every
   handle to an id, look up each referenced row so a diff can carry its `before`
   value and an update can carry the row's current `title`, turn
   `assigneeHandles` into `{ id, name }` pairs, and convert `dueOffsetDays` to an
   absolute `dueAt` from the event's `startsAt` in `CLUB_TIMEZONE` (D14).
   **Handles stop here** — they never reach the client, which is what lets the
   apply endpoint take plain ids.
7. `recordRun(tx, { userId, prompt: body.text, steps })`.
8. Persist the member's message and the assistant's reply into the `ai` channel,
   the reply stamped with `ai_run_id`.
9. Respond `200 { runId, reply, proposal }`, the proposal parsed by
   `aiResolvedProposalSchema` before it goes out.

Add the constant with its reasoning:

```typescript
/**
 * A hard stop on the read-tool loop. Six is enough for "find the event, read
 * last year's plan, check who is free, propose" and short enough that a model
 * that starts looping cannot spend the club's daily quota in one request.
 */
const MAX_TOOL_STEPS = 6;
```

Map typed errors to status codes at the bottom of the router, mirroring
`routes/events/events.ts`: `AiDisabledError` → 503 `AI_DISABLED`,
`AiQuotaError` → 429 `AI_QUOTA_EXCEEDED`, `AiOutputError` → 422
`AI_OUTPUT_INVALID`, each rendering the shared `ApiError` shape.

- [ ] **Step 5: Register the router**

In `backend/src/routes/index.ts`, import `aiRouter` from `./ai/ai.js` and mount
it with the others, after `threadsRouter`:

```typescript
apiRouter.use(aiRouter);
```

- [ ] **Step 6: Write the integration tests**

Create `backend/src/routes/ai/ai.integration.test.ts`, copying the session-mock
and TRUNCATE-isolation shape from `backend/src/routes/example/example.integration.test.ts`.
Stub the provider by mocking `../../lib/ai/client.js`. Cover:

- `503 AI_DISABLED` for every AI route when `AI_ENABLED` is unset.
- `200` with a reply and a null proposal for a question that stages nothing.
- `200` with a parsed proposal for a planning request.
- `422 AI_OUTPUT_INVALID` when the stub returns prose twice.
- `429 AI_QUOTA_EXCEEDED` when `ai_run` already holds `dailyRunCap` rows for the
  caller inside 24 hours.
- The member's message and the assistant's reply both land in the caller's `ai`
  channel, and the reply carries `ai_run_id`.

- [ ] **Step 7: Run the suites**

Run: `npx vitest run backend/src/routes/ai && npm run test:integration -- --run src/routes/ai`
Expected: PASS.

- [ ] **Step 8: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run test:integration
git add backend/src/routes/ai backend/src/routes/index.ts
git commit -m "feat(ai): add the assistant chat endpoint and tool loop"
```

---

## Task 7: The apply endpoint

**Files:**

- Create: `backend/src/routes/ai/apply.ts`
- Create: `backend/src/routes/ai/apply.test.ts`
- Modify: `backend/src/routes/ai/ai.ts`
- Modify: `backend/src/routes/ai/ai.integration.test.ts`

**Interfaces:**

- Consumes: Tasks 3–5; `aiApplyRequestSchema`, `type AiApplyOperation` from `@ctp/shared`; the event and task service functions the existing routes call.
- Produces: `requiredTierFor(operations: AiApplyOperation[]): Map<number, number>`; `orderOperations(operations: AiApplyOperation[]): AiApplyOperation[]`; `applyProposal(tx: Tx, caller: { id: string; tier: number; role: Role }, request: AiApplyRequest): Promise<AiApplyResponse>`; `POST /api/ai/proposals/apply`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/ai/apply.test.ts`:

```typescript
import type { AiApplyOperation } from "@ctp/shared";
import { describe, expect, it } from "vitest";
import { orderOperations, requiredTierFor } from "./apply.js";

const uuid = (n: number) => `0192f1a0-0000-7000-8000-00000000000${n}`;

const createEvent: AiApplyOperation = {
  op: "create",
  entity: "event",
  ref: "$event1",
  data: { title: "Hackathon", startsAt: new Date("2026-10-14T09:00:00.000Z") },
};
const createTask = (eventRef?: string): AiApplyOperation => ({
  op: "create",
  entity: "task",
  data: { title: "Book venue", priority: "medium", assigneeIds: [], eventRef },
});
const updateTask: AiApplyOperation = {
  op: "update",
  entity: "task",
  id: uuid(1),
  data: { priority: "high" },
};

describe("requiredTierFor", () => {
  it("puts a single task create at tier 0, matching POST /api/tasks", () => {
    expect([...requiredTierFor([createTask()]).keys()]).toEqual([0]);
  });

  it("raises two or more task creates to tier 1, matching POST /api/tasks/bulk", () => {
    expect([...requiredTierFor([createTask(), createTask()]).keys()]).toContain(1);
  });

  it("puts an event create at tier 1", () => {
    expect([...requiredTierFor([createEvent]).keys()]).toContain(1);
  });

  it("leaves a task update at tier 0, matching PATCH /api/tasks/:id", () => {
    expect([...requiredTierFor([updateTask]).keys()]).toEqual([0]);
  });
});

describe("orderOperations", () => {
  it("creates a staged event before the tasks that name it", () => {
    const ordered = orderOperations([createTask("$event1"), createEvent]);
    expect(ordered[0]).toBe(createEvent);
  });

  it("leaves an order with no dependency untouched", () => {
    const input = [updateTask, createTask()];
    expect(orderOperations(input)).toEqual(input);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run backend/src/routes/ai/apply.test.ts`
Expected: FAIL — `Cannot find module './apply.js'`.

- [ ] **Step 3: Write `backend/src/routes/ai/apply.ts`**

`requiredTierFor` returns a map of required tier → how many operations need it,
implementing spec §4.4's table exactly:

```typescript
/**
 * The permission mirror. Each operation is gated by the same check its
 * equivalent route uses, so "what the assistant can do" needs no second
 * document: it is what the member can do by hand. The single/bulk asymmetry is
 * deliberate — POST /api/tasks is tier 0 and POST /api/tasks/bulk is tier 1.
 */
```

`orderOperations` performs a stable topological sort: an operation creating an
event with `ref` R sorts before any task create whose `data.eventRef` is R.
Everything else keeps its input order.

`applyProposal` runs inside one `Tx`:

1. Reject when any required tier exceeds the caller's, with a `403 FORBIDDEN`
   naming the operation.
2. `orderOperations`.
3. For each operation, call the same service function the equivalent route
   calls; for an event update whose gate is "owner, or tier 1", perform the same
   owner check `routes/events/events.ts` performs. Substitute a `ref` with the
   real id as soon as its target is created.
4. Stamp `aiRunId` on every created or updated row.
5. `recordRunOutcome(tx, request.runId, request.stats)`.
6. Return `{ events, tasks }`.

A failure anywhere rolls the whole transaction back, so the board after a
confirmation is the plan that was on screen.

- [ ] **Step 4: Add the route to `ai.ts`**

```typescript
aiRouter.post(
  "/ai/proposals/apply",
  authenticate,
  authorise(0),
  validate(aiApplyRequestSchema, "body"),
  async (req, res) => {
    /* getDb().transaction(tx => applyProposal(tx, req.user!, body)) */
  },
);
```

- [ ] **Step 5: Extend the integration tests**

Append to `ai.integration.test.ts`:

- A tier-1 member applies an event plus seven tasks: `201`, the event exists,
  all seven tasks carry `ai_run_id` and the new event's id.
- A tier-0 member applying an event create gets `403`, and **nothing is
  written** — assert the event table is unchanged.
- A tier-0 member applying one task create gets `201`.
- A tier-0 member applying two task creates gets `403`.
- An operation naming an unknown `id` rolls the whole batch back: assert the
  other operations in the same request wrote nothing.
- `ai_run` carries `proposed_count`, `kept_count` and `edited_count` after a
  successful apply.

- [ ] **Step 6: Run the suites**

Run: `npx vitest run backend/src/routes/ai && npm run test:integration -- --run src/routes/ai`
Expected: PASS.

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run test:integration
git add backend/src/routes/ai
git commit -m "feat(ai): apply confirmed proposals in one transaction"
```

---

## Task 8: Thread summaries

**Files:**

- Modify: `backend/src/routes/ai/service.ts`, `backend/src/routes/ai/service.test.ts`
- Modify: `backend/src/routes/ai/ai.ts`, `backend/src/routes/ai/ai.integration.test.ts`

**Interfaces:**

- Consumes: Task 4; `assertCanReadChannel(db: Queryable, channelId: string, user: { id: string; tier: number }): Promise<void>` from `routes/threads/service.js` (Task 5, Step 4b); `aiThreadSummarySchema`, `aiThreadSummaryResponseSchema` from `@ctp/shared`.
- Produces: `type PromptMessage = { id: string; author: string; body: string; createdAt: Date }`; `budgetMessages(messages: PromptMessage[], maxChars: number): PromptMessage[]`; `buildSummaryPrompt(messages: PromptMessage[]): string`; `POST /api/ai/threads/:id/summary`.

- [ ] **Step 1: Confirm the visibility helper is in place**

`assertCanReadChannel` was extracted into `backend/src/routes/threads/service.ts`
in Task 5, Step 4b, because `readThread` needed it there. Confirm it exists and
that `threads.ts` imports it rather than holding a second copy, then import it
here. There must be exactly one implementation.

- [ ] **Step 2: Write the failing test**

Append to `backend/src/routes/ai/service.test.ts`:

```typescript
import { budgetMessages } from "./service.js";

describe("budgetMessages", () => {
  const message = (id: string, body: string) => ({
    id,
    author: "Alice",
    body,
    createdAt: new Date(0),
  });

  it("keeps everything when it fits", () => {
    expect(budgetMessages([message("1", "hello"), message("2", "world")], 1000)).toHaveLength(2);
  });

  it("drops the oldest first, because a catch-up needs the recent end", () => {
    const input = [
      message("1", "a".repeat(60)),
      message("2", "b".repeat(60)),
      message("3", "c".repeat(60)),
    ];
    expect(budgetMessages(input, 140).map((row) => row.id)).toEqual(["2", "3"]);
  });

  it("truncates one oversized message rather than dropping the whole thread", () => {
    const kept = budgetMessages([message("1", "x".repeat(500))], 100);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.body.length).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run backend/src/routes/ai/service.test.ts`
Expected: FAIL — `budgetMessages is not exported`.

- [ ] **Step 4: Add the budgeter and prompt builder to `routes/ai/service.ts`**

```typescript
export type PromptMessage = { id: string; author: string; body: string; createdAt: Date };

/**
 * Free-tier context windows are small, and one pasted wall of text otherwise
 * blows the request. Budget by CHARACTERS, not message count — oldest dropped
 * first, because the recent end of a thread is what a catch-up needs.
 */
export function budgetMessages(messages: PromptMessage[], maxChars: number): PromptMessage[] {
  const kept: PromptMessage[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const remaining = maxChars - used;
    if (remaining <= 0) break;
    const body = message.body.length > remaining ? message.body.slice(0, remaining) : message.body;
    kept.unshift({ ...message, body });
    used += body.length;
  }
  return kept;
}

export function buildSummaryPrompt(messages: PromptMessage[]): string {
  return [
    "Summarise this club discussion thread for a committee member catching up.",
    "Reply with ONE JSON object and nothing else. No markdown, no commentary.",
    "",
    '{"summary": ["3-5 short bullets, most important first"],',
    ' "actionItems": [{"text": "what needs doing", "suggestedAssigneeName": "a name from the thread, or null"}]}',
    "",
    "Only use names that appear as authors below. Invent nothing. If nothing was decided, return an empty actionItems array.",
    "",
    ...messages.map((message) => `${message.author}: ${message.body}`),
  ].join("\n");
}
```

- [ ] **Step 5: Add the route to `ai.ts`**

Constants: `const SUMMARY_MESSAGE_LIMIT = 100;` and `const SUMMARY_CHAR_BUDGET = 12000;`.

In order: reject when disabled; check the daily cap; call
`assertCanReadChannel`; load the newest `SUMMARY_MESSAGE_LIMIT` messages;
`budgetMessages`; `completeJson(complete, buildSummaryPrompt(kept), aiThreadSummarySchema)`;
`recordRun`; respond `200 { summary, asOfMessageId }` where `asOfMessageId` is
the newest message's id.

Add an in-process `Map` cache keyed on `` `${channelId}:${newestMessageId}` ``,
capped at 50 entries with the oldest evicted:

```typescript
/**
 * A local convenience: reopening a tab during development costs nothing. On
 * Vercel each invocation is a fresh process, so AI_DAILY_RUN_CAP is the quota
 * guard that matters. Keyed on the newest message id, so a summary is never
 * served for a thread that has moved on.
 */
```

- [ ] **Step 6: Add integration tests**

Cover: `200` with bullets on a thread the member can read; `403` on a channel
they cannot; `422` when the stub returns junk twice; and a second identical
request served from cache with the stub called only once.

- [ ] **Step 7: Run the suites**

Run: `npx vitest run backend/src/routes/ai && npm run test:integration -- --run src/routes`
Expected: PASS, including `threads.integration.test.ts` unchanged.

- [ ] **Step 8: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run test:integration
git add backend/src/routes/ai backend/src/routes/threads
git commit -m "feat(ai): add thread summaries (R9)"
```

---

## Task 9: The daily briefing

**Files:**

- Modify: `backend/src/routes/ai/service.ts`, `backend/src/routes/ai/service.test.ts`
- Modify: `backend/src/routes/ai/ai.ts`, `backend/src/routes/ai/ai.integration.test.ts`

**Interfaces:**

- Consumes: Tasks 4, 5; `aiBriefingSchema`, `aiBriefingResponseSchema` from `@ctp/shared`; `CLUB_TIMEZONE` from `config/club.ts`.
- Produces: `clubDayKey(now: Date, timeZone: string): string`; `findTodaysBriefing(db: Queryable, userId: string, dayKey: string): Promise<{ briefing: AiBriefing; generatedAt: Date } | undefined>`; `buildBriefingPrompt(input: BriefingInput): string`; `GET /api/ai/briefing`.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/routes/ai/service.test.ts`:

```typescript
import { clubDayKey } from "./service.js";

describe("clubDayKey", () => {
  it("returns the club's calendar day, not UTC's", () => {
    // 2026-10-14T22:30Z is already the 15th in Melbourne (UTC+11 in October).
    expect(clubDayKey(new Date("2026-10-14T22:30:00.000Z"), "Australia/Melbourne")).toBe(
      "2026-10-15",
    );
  });

  it("is stable across the same club day", () => {
    const zone = "Australia/Melbourne";
    const morning = clubDayKey(new Date("2026-10-14T00:00:00.000Z"), zone);
    const evening = clubDayKey(new Date("2026-10-14T08:00:00.000Z"), zone);
    expect(morning).toBe(evening);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run backend/src/routes/ai/service.test.ts`
Expected: FAIL — `clubDayKey is not exported`.

- [ ] **Step 3: Implement `clubDayKey` in `routes/ai/service.ts`**

```typescript
/**
 * One briefing per member per CLUB day. Computed in CLUB_TIMEZONE rather than
 * UTC for the same reason `daysUntil` is: an evening in Melbourne is already
 * tomorrow in UTC, and the briefing would roll over mid-evening.
 */
export function clubDayKey(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
```

- [ ] **Step 4: Add `buildBriefingPrompt` and `findTodaysBriefing`**

`buildBriefingPrompt` takes the counts and lists the dashboard already computes
— the caller's open tasks, overdue count, the `[today, +7d)` events with their
task counts, and committee load — and asks for one JSON object matching
`aiBriefingSchema`: a one- or two-sentence `summary` plus up to four `bullets`.
Instruct it to name only members and events present in the input.

`findTodaysBriefing` selects the newest message in the caller's `ai` channel
whose `ai_run_id` is set and whose `created_at` falls on `dayKey` in
`CLUB_TIMEZONE`, parsing its body with `aiBriefingSchema`.

- [ ] **Step 5: Add the route to `ai.ts`**

`GET /api/ai/briefing`, `authenticate`, `authorise(0)`. In order: 503 when
disabled; `findTodaysBriefing` and return it if present; otherwise check the
daily cap, gather the dashboard figures with the read tools from Task 5,
`completeJson(..., aiBriefingSchema)`, `recordRun`, store the briefing as a
message in the caller's `ai` channel stamped with `ai_run_id`, and respond
`200 { briefing, generatedAt }`.

- [ ] **Step 6: Add integration tests**

Cover: first call generates and stores exactly one message; a second call the
same club day returns the same `generatedAt` **without** calling the stub again;
`503` when disabled.

- [ ] **Step 7: Run the suites**

Run: `npx vitest run backend/src/routes/ai && npm run test:integration -- --run src/routes/ai`
Expected: PASS.

- [ ] **Step 8: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run test:integration
git add backend/src/routes/ai
git commit -m "feat(ai): add the daily briefing endpoint (R7)"
```

---

## Task 10: The proposal card

**Files:**

- Create: `frontend/src/lib/ai-sections.ts`
- Create: `frontend/src/lib/ai-sections.test.ts`
- Create: `frontend/src/components/ai/create-task-row.tsx`
- Create: `frontend/src/components/ai/create-event-row.tsx`
- Create: `frontend/src/components/ai/diff-row.tsx`
- Create: `frontend/src/components/ai/proposal-card.tsx`
- Create: `frontend/src/components/ai/proposal-card.test.tsx`

**Interfaces:**

- Consumes: `AiProposal`, `AiApplyOperation`, `createTaskSchema` from `@ctp/shared`; `components/tasks/assignee-field.tsx`; `components/ui/date-time-picker.tsx`; `components/ui/input.tsx`.
- Produces: `type CardSection = { key: string; kind: "create-event" | "create-task" | "update-event" | "update-task" | "reassign-task"; label: string; rows: CardRow[] }`; `deriveSections(proposal: AiProposal): CardSection[]`; `<ProposalCard proposal onApply(operations, stats) onDiscard />`.

- [ ] **Step 1: Write the failing derivation test**

Create `frontend/src/lib/ai-sections.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { deriveSections } from "./ai-sections.js";

describe("deriveSections", () => {
  it("labels a task create section", () => {
    const [section] = deriveSections({ createTasks: [{ title: "Book venue" }] } as never);
    expect(section?.label).toBe("Create tasks");
  });

  it("labels an event create section", () => {
    const [section] = deriveSections({
      createEvent: { ref: "$event1", title: "Hackathon" },
    } as never);
    expect(section?.label).toBe("Create event");
  });

  it("calls a task diff that touches only assignees a reassignment", () => {
    const [section] = deriveSections({
      updateTasks: [{ handle: "T1", assigneeHandles: ["M2"] }],
    } as never);
    expect(section?.kind).toBe("reassign-task");
    expect(section?.label).toBe("Reassign tasks");
  });

  it("calls a task diff touching any other field an update", () => {
    const [section] = deriveSections({
      updateTasks: [{ handle: "T1", assigneeHandles: ["M2"], priority: "high" }],
    } as never);
    expect(section?.kind).toBe("update-task");
    expect(section?.label).toBe("Update tasks");
  });

  it("orders a created event before the tasks that depend on it", () => {
    const sections = deriveSections({
      createTasks: [{ title: "Book venue", eventRef: "$event1" }],
      createEvent: { ref: "$event1", title: "Hackathon" },
    } as never);
    expect(sections[0]?.kind).toBe("create-event");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run frontend/src/lib/ai-sections.test.ts`
Expected: FAIL — `Cannot find module './ai-sections.js'`.

- [ ] **Step 3: Write `frontend/src/lib/ai-sections.ts`**

```typescript
/**
 * Section identity is DERIVED from the payload, never declared by the model, so
 * a mislabelled section is impossible. A task diff whose every changed field is
 * `assigneeHandles` is a reassignment; anything else is an update.
 */
```

Implement `deriveSections` per spec §5.2's table, with the create-event section
sorted first so a plan reads in the order it will be applied.

- [ ] **Step 4: Write the three row components**

`create-task-row.tsx` renders a native `<input type="checkbox">`, an
`Input` for the title, `AssigneeField` for assignees, and `DateTimePicker` for
the due date. Every field edits in place — there is no edit mode. Each row
`safeParse`s itself against `createTaskSchema` and renders the first message
under the offending field.

`create-event-row.tsx` is the same shape over title, `startsAt`, `endsAt` and
venue.

`diff-row.tsx` renders the row's label, then one line per changed field as
`before → after`, where the **before is immutable text and the after is
editable**. A diff row has no way to change which row it targets; excluding it
is what the checkbox is for.

Each row takes `checked`, `onCheckedChange`, `value`, `onChange` and
`disabled` — `disabled` is how the card greys a task whose staged event has
been unchecked.

- [ ] **Step 5: Write `proposal-card.tsx`**

Holds the edited proposal as state. Renders one section per `deriveSections`
entry inside a scroll region and pins the footer outside it, following
`ui/dialog.tsx:79`:

```tsx
<div className="max-h-[min(28rem,60vh)] overflow-y-auto overscroll-contain">{/* sections */}</div>
<div className="border-t px-4 py-3">{/* footer */}</div>
```

The footer button's label names what will happen — `Create 1 event + 7 tasks`,
`Apply 4 changes` — counting only checked, valid rows, and is disabled while any
checked row fails validation. Unchecking a create-event row disables every task
row whose `eventRef` matches it. `+ Add a task` appends an empty create row.

`onApply` receives the operations built from the checked rows plus
`{ proposed, kept, edited }`, where `edited` counts rows whose value differs
from what the model proposed.

- [ ] **Step 6: Write the failing component test**

Create `frontend/src/components/ai/proposal-card.test.tsx` covering:

- every proposed row renders, checked by default;
- the footer label and count track the checkboxes;
- unchecking a staged event disables its dependent task rows;
- editing a title to empty disables the footer button;
- `onApply` reports `edited: 1` after one field is changed.

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `npx vitest run frontend/src/lib frontend/src/components/ai`
Expected: PASS.

- [ ] **Step 8: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run test:unit
git add frontend/src/lib/ai-sections.ts frontend/src/lib/ai-sections.test.ts frontend/src/components/ai
git commit -m "feat(ai): add the editable proposal card"
```

---

## Task 11: The assistant page

**Files:**

- Create: `frontend/src/hooks/use-assistant.ts`
- Create: `frontend/src/hooks/use-assistant.test.tsx`
- Modify: `frontend/src/routes/ai-breakdown.tsx`
- Modify: `frontend/src/routes/event-detail.tsx`

**Interfaces:**

- Consumes: Task 10's `ProposalCard`; `aiMessageResponseSchema`, `aiApplyResponseSchema` from `@ctp/shared`; `useThreads`, `useThreadMessages`, `useTasks`.
- Produces: `useAssistant(seed?: { eventId?: string })` returning `{ state, send(text), apply(operations, stats), pending }`, where `state` follows the repo's `{ status: "loading" | "ok" | "error" }` union.

- [ ] **Step 1: Write the failing hook test**

Create `frontend/src/hooks/use-assistant.test.tsx` covering: `send` posting to
`/api/ai/messages` and exposing the reply; a staged proposal surfacing on the
returned state; `apply` posting to `/api/ai/proposals/apply` and clearing the
staged proposal on success; a `503` response surfacing as a disabled state
rather than an error strip.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run frontend/src/hooks/use-assistant.test.tsx`
Expected: FAIL — `Cannot find module './use-assistant.js'`.

- [ ] **Step 3: Write `use-assistant.ts`**

Follow `use-tasks.ts` exactly: a discriminated-union state, `useCallback`
actions, response bodies parsed with the shared schema before they reach state.
Data-fetching and state live here; the route component stays declarative (MVVM).

- [ ] **Step 4: Rebuild `routes/ai-breakdown.tsx` as the chat**

Keep the page's existing "Generated tasks" rail (tasks filtered on `aiRunId`),
widened to list assistant-created events too. Replace the "Planning is not
connected yet" banner with the composer and the message list; render a
`ProposalCard` under any assistant message that staged one. Read the seed from
the URL (`/ai?eventId=…`).

When `/api/ai/messages` answers `503`, render the page's disabled state — the
history rail still shows past runs.

- [ ] **Step 5: Add the entry point on the event page**

In `frontend/src/routes/event-detail.tsx`, add a "Plan with AI" `Button` to the
Tasks tab header linking to `/ai?eventId=${event.id}`. Render it only when
`me.tier >= 1`, matching the tier that may create the tasks it will propose.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run frontend/src`
Expected: PASS, including the existing `ai-breakdown.test.tsx` updated for the
new page.

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run test:unit
git add frontend/src/hooks/use-assistant.ts frontend/src/hooks/use-assistant.test.tsx frontend/src/routes/ai-breakdown.tsx frontend/src/routes/ai-breakdown.test.tsx frontend/src/routes/event-detail.tsx
git commit -m "feat(ai): turn the AI page into the assistant chat"
```

---

## Task 12: The briefing card and the summary panel

**Files:**

- Create: `frontend/src/hooks/use-briefing.ts`
- Create: `frontend/src/components/ai/briefing-card.tsx`
- Create: `frontend/src/hooks/use-thread-summary.ts`
- Create: `frontend/src/components/ai/thread-summary-panel.tsx`
- Create: colocated `.test.tsx` for each component and `.test.ts` for each hook
- Modify: `frontend/src/routes/dashboard.tsx`
- Modify: `frontend/src/routes/event-detail.tsx`

**Interfaces:**

- Consumes: `aiBriefingResponseSchema`, `aiThreadSummaryResponseSchema` from `@ctp/shared`.
- Produces: `useBriefing()`; `<BriefingCard />`; `useThreadSummary(channelId)`; `<ThreadSummaryPanel channelId />`.

- [ ] **Step 1: Write the failing tests**

`use-briefing.test.ts`: reads `GET /api/ai/briefing`, exposes `{ summary, bullets }`, and reports a `503` as `status: "disabled"`.

`briefing-card.test.tsx`: renders the summary and bullets with an "Ask the assistant" link to `/ai`; **renders nothing at all** when the hook reports `disabled`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run frontend/src/hooks/use-briefing.test.ts frontend/src/components/ai/briefing-card.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the hooks and components**

`BriefingCard` matches the right rail's existing `Card` + `SectionHeading`
shape in `dashboard.tsx` so it sits with Today, Recent Activity and Committee
Load rather than beside them.

`ThreadSummaryPanel` renders bullets and action items, with a Summarise button
that calls the endpoint on demand and a re-run control once a summary is shown.

- [ ] **Step 4: Mount them**

Add `<BriefingCard />` to the top of `dashboard.tsx`'s right rail. Add
`<ThreadSummaryPanel channelId={…} />` above the message list on
`event-detail.tsx`'s Thread tab.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run frontend/src`
Expected: PASS, including `dashboard.test.tsx` and `event-detail.test.tsx`
unchanged in their existing assertions.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run test:unit
git add frontend/src/hooks frontend/src/components/ai frontend/src/routes/dashboard.tsx frontend/src/routes/event-detail.tsx
git commit -m "feat(ai): add the dashboard briefing and thread summary panel"
```

---

## Task 13: E2E, docs, and the full gate

**Files:**

- Create: `e2e/ai.spec.ts`
- Modify: `docs/api-endpoints.md`, `docs/prd.md`, `docs/contributing.md`

**Interfaces:**

- Consumes: everything above.
- Produces: the green `npm run verify` that gates the PR.

- [ ] **Step 1: Write `e2e/ai.spec.ts`**

With `AI_ENABLED` unset, which is the default the suite runs under:

- `/ai` loads, shows its disabled state, and the history rail still renders.
- The dashboard renders its usual widgets and **no** briefing card.
- An axe scan of `/ai` reports no violations.

Then one spec with the route stubbed via `page.route("**/api/ai/messages", …)`
returning a fixed proposal: the card renders, a row can be unchecked, the footer
count follows, and an axe scan of the rendered card reports no violations. The
card is the most complex interactive surface in the app, which is why it gets
its own scan (R13, US-21).

- [ ] **Step 2: Run the E2E suite**

Run: `npm run test:e2e`
Expected: PASS.

- [ ] **Step 3: Reconcile the API docs with what shipped**

Read `docs/api-endpoints.md`'s `## AI` section against the four routes as built.
Correct any drift in request or response shapes — the zod schemas in
`shared/src/schemas/ai/ai.ts` are the source of truth and that page says so.

- [ ] **Step 4: Update the PRD**

In `docs/prd.md`, move R15's status from ⬜ to 🟡 and note what is built versus
what remains. Leave the band at Deferred.

- [ ] **Step 5: Add one line to `docs/contributing.md`**

Under the unit-testing tier, note that AI services and tools take a
`CompletionFn` as a parameter, so unit tests pass a fake and the tier stays
DB-free and network-free.

- [ ] **Step 6: Run the full gate**

```bash
npm run verify
```

Expected: PASS — `typecheck && lint && format:check && test:unit && test:integration && test:e2e`. Docker Postgres must be up and Playwright browsers installed.

- [ ] **Step 7: Commit and open the PR**

```bash
git add e2e/ai.spec.ts docs
git commit -m "docs(ai): document the assistant endpoints and mark R15 in progress"
```

Open the PR against `main` from `gkur0003/ai-assistant`.

---

## Risks

| Risk                                                          | Likelihood | Mitigation                                                                                             |
| ------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| Free-tier rate limit hit during the demo                      | High       | `AI_DAILY_RUN_CAP`, dropped to 10–15 for demo week; 429 renders as a readable message; E2E runs AI off |
| `@google/genai` call shape differs from Task 1's sketch       | Medium     | Isolated in `client.ts` behind `GenAiLike`; the five unit tests fail loudly and locally                |
| Model returns prose instead of JSON                           | Medium     | `extractJson` + one retry + `safeParse`; fails to a 422 that writes nothing                            |
| Model loops on tool calls                                     | Medium     | `MAX_TOOL_STEPS = 6`, plus the daily cap                                                               |
| `assertCanReadChannel` extraction regresses the threads route | Low        | `threads.integration.test.ts` must pass unchanged — that is the behaviour-preserving check             |
| Supervisor objects to sending member messages to Google       | Medium     | `AI_ENABLED` defaults off; R14 paragraph agreed before the summary ships                               |
| `event.ai_run_id` introduces a schema import cycle            | Low        | One-directional edge; adjust the barrel ordering in `db/schema/index.ts` if `tsc` complains            |
