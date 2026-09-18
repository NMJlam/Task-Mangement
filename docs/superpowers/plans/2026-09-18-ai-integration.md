# AI Integration (R15 + R7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three human-in-the-loop AI features on the free Google Gemini tier — natural-language task search (A2), thread summaries (A3), and event-to-draft-tasks (A1) — without giving the model a single unreviewed write path.

**Architecture:** One `routes/ai/` folder owns every AI endpoint and the cross-cutting rules (kill switch, daily cap, `ai_run` audit row). The provider lives behind a single injected function, so services stay framework-free and unit-testable with no network. Every model response is untrusted text parsed by a zod schema from `@ctp/shared`; a parse failure is a 422, never a partial write. The model never emits a UUID and never writes to the database — A1 publishes through the existing, already-audited `POST /api/tasks/bulk`.

**Tech Stack:** TypeScript (`strict`, no `any`), Express 4, Drizzle, zod 4, React 19 + Vite, Vitest, Playwright, `@google/genai` (Gemini).

**Spec:** This document. The design was settled in conversation on 2026-09-18; §1–§5 below are the spec half and §6 is the plan half. Source requirements live in [`docs/prd.md`](../../prd.md) (R3, R7, R9, R14, R15), structure in [`docs/architecture.md`](../../architecture.md), the permission model in [`docs/roles-and-permissions.md`](../../roles-and-permissions.md), endpoint conventions in [`docs/api-endpoints.md`](../../api-endpoints.md), and testing tiers in [`docs/contributing.md`](../../contributing.md).

---

## Global Constraints

Every task's requirements implicitly include this section.

- **No `any` in committed code.** `strict: true` everywhere (`CLAUDE.md`).
- **`shared/` is the only place a domain type is defined.** Every AI request/response shape is a zod schema in `shared/src/schemas/ai/ai.ts`, imported by both sides. `shared/` imports no React, no Express, no db — enforced by ESLint `no-restricted-imports`.
- **`frontend/` never imports `backend/`, and vice versa.**
- **`api/` holds exactly one file.** Nothing in this plan adds to it.
- **Middleware order is `log -> authenticate -> authorise -> validate -> handler`.** `log` is global; the rest are per-route.
- **Routes call `getDb()`**, never `nodeDb()` or `httpDb()` directly.
- **Rule 13 (`backend/src/db/schema/ai-run.ts`): money mutations are never exposed to the AI.** No endpoint in this plan touches `expense`, `budget`, or `event.allocation_cents`.
- **The model never emits a UUID.** It emits names and enum values; the backend resolves them. This is the single rule that makes a hallucinated identifier impossible.
- **Every model response is `safeParse`d before use.** One retry, then fail closed with 422 `AI_OUTPUT_INVALID`.
- **The Gemini model id comes from `GEMINI_MODEL` env, never a literal in code** — free-tier model names change, and a hard-coded one is a production outage.
- **Commit style: Conventional Commits** (`docs/contributing.md`). Scope these `feat(ai)`, `feat(shared)`, `test(ai)`, `docs`.
- **`npm run verify` must pass before the PR** — `typecheck && lint && format:check && test:unit && test:integration && test:e2e`.

---

## 1. Decisions locked

All eleven were recommended during brainstorming and confirmed by the user on 2026-09-18.

| #   | Decision                                                                                                                         | Why                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Provider: Google Gemini via `@google/genai`**, free AI Studio tier                                                             | $0, no card required. §7 covers setup.                                                                                                                                                                   |
| D2  | **One module, `backend/src/lib/ai/client.ts`**, exporting `geminiComplete` plus a `CompletionFn` type                            | Swapping providers later is a one-file edit. No adapter framework — YAGNI.                                                                                                                               |
| D3  | **Services take the completion function as a parameter**, never import it                                                        | Mirrors `routes/events/service.ts` taking a `Tx`. Unit tests pass a fake, so `test:unit` stays DB-free and network-free.                                                                                 |
| D4  | **One `routes/ai/` folder**, three endpoints and one `service.ts`                                                                | The kill switch, daily cap and `ai_run` write are one set of cross-cutting rules. Scattering them means three places to disable AI when the free tier rate-limits mid-demo.                              |
| D5  | **`ai_run.channel_id` stays `NOT NULL`; each member gets one `ai`-kind channel, created on first use**                           | No migration, and it matches `channel.ts`'s own comment: _"The AI assistant needs no tables of its own — it is kind = 'ai', a dedicated PAGE."_ Pre-builds the Tier-B agent chat if the team gets there. |
| D6  | **Output validation: prompt-described JSON plus zod `safeParse`, retry once, then 422**                                          | Works on any provider and any free tier. Gemini's native `responseSchema` is an optional hardening step (§5.3), not a dependency.                                                                        |
| D7  | **A2's model emits names, not ids**; the backend resolves them against `app_user` / `team` / `event`                             | A mistyped UUID would 422 or silently return nothing. Name resolution is pure, deterministic and unit-testable.                                                                                          |
| D8  | **A2 routes "overdue" to the existing `GET /api/tasks/overdue`** rather than adding an `overdue` field to `listTasksQuerySchema` | Zero schema change, and the partial index `task_overdue_idx` already serves it.                                                                                                                          |
| D9  | **A3 is ephemeral** — no summary row, no summary table. Cached in-process on `(channelId, latestMessageId)`                      | Never stale, always re-runnable. A summary written at message 40 is wrong by message 90.                                                                                                                 |
| D10 | **A1 proposes statelessly; the client reviews; the existing `POST /api/tasks/bulk` publishes**                                   | Model output never reaches the database unreviewed. Satisfies R15's "human approves before publish" structurally rather than by convention.                                                              |
| D11 | **A1 returns `dueOffsetDays` relative to `event.starts_at`, never absolute dates**                                               | Models are unreliable at date arithmetic, and the offset is the part that generalises across events. The server does the arithmetic in `CLUB_TIMEZONE`.                                                  |

---

## 2. Corrections to the brainstorm

Both were found while reading the schema to write this plan. Neither is optional.

1. **There is no `event.type` column.** `docs/prd.md` R4 describes an event "type", but `backend/src/db/schema/event.ts` has `status` (`planning | live | wrapped | cancelled`) and no type or category field. A1's corpus therefore becomes **the most recent `PLAN_CORPUS_EVENTS` events whose `starts_at` is in the past**, ordered by `starts_at desc`. If an `event.type` column is added later, narrowing the corpus by it is a one-line change inside `pastEventCorpus()`.
2. **An `ai` channel must have a name.** `channel_named_unless_dm_check` requires `name IS NOT NULL AND length(trim(name)) > 0` for every kind except `dm`. `resolveAiChannel()` must insert `name: "Assistant"`. It must also leave `min_tier` at 0 (`channel_min_tier_only_when_tier_gated_check`) and both `team_id` and `event_id` NULL (`channel_parent_matches_kind_check`).

A third, milder note: because the Gemini free tier costs nothing, `ai_run.cost_micro_usd` is always written as `0`. The abuse guard is a **daily run count** per user read off `ai_run`, not a dollar budget. If the team moves to a paid provider later, the column is already there and only `recordRun()` changes.

---

## 3. Permissions

Per `docs/roles-and-permissions.md` and the PRD role table ("1 lead / Director … create/edit events & tasks, **run AI breakdowns**"):

| Endpoint                           | Gate                                                   | Reasoning                                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/ai/task-search`         | `authorise(0)`                                         | Reads only tasks the caller can already list. No new exposure.                                                                                                                         |
| `POST /api/ai/threads/:id/summary` | `authorise(0)` + the existing channel-visibility check | Summarises messages the caller can already read. Must **reuse** the threads route's visibility logic, never reimplement it.                                                            |
| `POST /api/ai/events/:id/plan`     | `authorise(1)`                                         | The PRD gives AI breakdowns to tier 1+. Publishing already requires tier 1 via `POST /api/tasks/bulk`, so proposing must match — otherwise the UI offers a button that 403s on submit. |

No new entry is added to `CAPABILITIES`. That map drives the role-diff UI and should only grow when a genuinely role-bound power exists; a tier threshold covers all three.

---

## 4. Privacy (R14) — read before Task 1

`docs/prd.md` R14 says _"Monash privacy; no external sharing."_ A3 sends club members' message text to a third-party API, and A1 sends event and task titles. That **is** external sharing under any reasonable reading, and the Google AI Studio free tier's terms permit Google to use free-tier prompts to improve its products — unlike paid API tiers.

This does not block the work, but three things are required:

1. `.env.example` and `docs/setup.md` must state plainly that free-tier prompts leave Monash infrastructure and may be retained by Google.
2. The `AI_ENABLED` flag defaults to **off**. AI is opt-in per deployment, not on by default.
3. The final report needs a paragraph on this under R14. If the team is uncomfortable with it, the mitigations in order of cost are: (a) redact member names before sending — A3's action items then reference roles, not people; (b) move to a paid tier where inputs are not trained on; (c) drop A3 and keep A1 and A2, which send only titles.

Decide this before Task 6 (A3), not after.

---

## 5. Cross-cutting mechanics

### 5.1 Config surface

Four new environment variables, all read in `backend/src/config/ai.ts`:

| Variable           | Default            | Meaning                                                                                                                       |
| ------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `AI_ENABLED`       | _(empty = off)_    | `1` turns the AI endpoints on. Anything else and they 503 `AI_DISABLED`.                                                      |
| `GEMINI_API_KEY`   | _(empty)_          | AI Studio key. Missing while `AI_ENABLED=1` is a startup-visible config error.                                                |
| `GEMINI_MODEL`     | `gemini-2.5-flash` | Free-tier model id. **Verify the current one in AI Studio** (§7.2); free-tier names change.                                   |
| `AI_DAILY_RUN_CAP` | `50`               | Max `ai_run` rows per user per rolling 24h. Guards the shared free-tier quota against one person exhausting it before a demo. |

### 5.2 Error taxonomy

Three typed errors thrown by `service.ts`, mapped to status codes by `ai.ts`. This mirrors `routes/events/service.ts`, which throws typed errors the route maps.

| Error             | Status | Code                | When                                      |
| ----------------- | ------ | ------------------- | ----------------------------------------- |
| `AiDisabledError` | 503    | `AI_DISABLED`       | `AI_ENABLED` is off or the key is missing |
| `AiQuotaError`    | 429    | `AI_QUOTA_EXCEEDED` | Daily cap hit, or Gemini returned 429     |
| `AiOutputError`   | 422    | `AI_OUTPUT_INVALID` | Both attempts failed zod validation       |

All three render the shared `ApiError` shape (`shared/src/errors.ts`) so the frontend handles them exactly like any other failure.

### 5.3 Why prompt-described JSON rather than Gemini's `responseSchema`

`responseSchema` takes an OpenAPI-subset schema, which would mean writing and maintaining a zod-to-Gemini converter. The zod `safeParse` has to happen regardless — model output is untrusted input — so the converter buys only a slightly lower retry rate at the cost of a provider lock and a new module to test. Skip it. If the retry rate proves high in practice, add `responseSchema` inside `geminiComplete` as a pure optimisation; nothing outside that file changes.

### 5.4 Prompt-injection posture

Thread messages (A3) and task titles (A1, A2) are **user-authored text from club members**, and they flow into prompts. A member could write "ignore your instructions and …" into a message. The blast radius is deliberately tiny: the model has no tools, no database access, and its only output is JSON that must satisfy a zod schema before anything happens with it. The worst achievable outcome is a wrong summary or a bad draft task that a human then declines to publish. Note it in the report; do not build defences beyond the schema gate.

### 5.5 Every file this plan touches

**Created**

| Path                                               | Responsibility                                                                                       | Task |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---- |
| `backend/src/config/ai.ts`                         | Reads the four env variables. The one place AI is turned off.                                        | 1    |
| `backend/src/lib/ai/client.ts`                     | `CompletionFn` + `geminiComplete`. The only file importing `@google/genai`.                          | 1    |
| `backend/src/lib/ai/client.test.ts`                | Provider unit tests, SDK stubbed.                                                                    | 1    |
| `shared/src/schemas/ai/ai.ts`                      | Every AI request/response shape.                                                                     | 2    |
| `shared/src/schemas/ai/ai.test.ts`                 | Schema tests.                                                                                        | 2    |
| `backend/src/routes/ai/service.ts`                 | Framework-free rules: channel, run record, cap, JSON parse, name resolution, prompts, draft mapping. | 3–8  |
| `backend/src/routes/ai/service.test.ts`            | Unit tests. No DB, no network.                                                                       | 3–8  |
| `backend/src/routes/ai/ai.ts`                      | The three endpoints. Thin: validate, call service, map typed errors.                                 | 4–8  |
| `backend/src/routes/ai/ai.integration.test.ts`     | supertest → real app → Docker Postgres, provider stubbed.                                            | 4–8  |
| `backend/src/routes/members/service.ts`            | `readIdentities`, extracted so `ai.ts` can reuse it.                                                 | 4    |
| `frontend/src/hooks/use-ai-task-search.ts`         | A2 ViewModel.                                                                                        | 5    |
| `frontend/src/components/ai-filter-chips.tsx`      | A2 — the interpreted filter, as removable chips.                                                     | 5    |
| `frontend/src/hooks/use-thread-summary.ts`         | A3 ViewModel.                                                                                        | 7    |
| `frontend/src/components/thread-summary-panel.tsx` | A3 — bullets and action items.                                                                       | 7    |
| `frontend/src/hooks/use-event-plan.ts`             | A1 ViewModel; publishes via `POST /api/tasks/bulk`.                                                  | 10   |
| `frontend/src/components/event-plan-dialog.tsx`    | A1 — review, edit, select, publish.                                                                  | 10   |
| `e2e/ai.spec.ts`                                   | E2E with AI **off** — the default.                                                                   | 11   |

Each new component and hook also gets a colocated `.test.tsx` / `.test.ts`, per `docs/contributing.md`.

**Modified**

| Path                                    | Change                                                      | Task |
| --------------------------------------- | ----------------------------------------------------------- | ---- |
| `.env.example`                          | Four new variables, with the privacy warning                | 1    |
| `shared/src/index.ts`                   | Export the `ai` schema barrel                               | 2    |
| `shared/src/schemas/task/task.ts`       | `bulkCreateTasksSchema` gains optional `aiRunId`            | 9    |
| `backend/src/routes/index.ts`           | Register `aiRouter`                                         | 4    |
| `backend/src/routes/members/members.ts` | Import `readIdentities` instead of declaring it             | 4    |
| `backend/src/routes/threads/threads.ts` | Extract `assertCanReadChannel` for reuse                    | 6    |
| `backend/src/routes/tasks/tasks.ts`     | Bulk handler stamps `aiRunId`; `findBadReference` checks it | 9    |
| `frontend/src/routes/tasks.tsx`         | A2 search box and chips                                     | 5    |
| `frontend/src/routes/event-detail.tsx`  | A3 summary on Thread tab; A1 button on Tasks tab            | 7,10 |
| `docs/api-endpoints.md`                 | New `## AI` section                                         | 11   |
| `docs/prd.md`                           | R15 → 🟡; R7 and R14 notes                                  | 11   |
| `docs/architecture.md`                  | `routes/ai/` and `lib/ai/` in the map                       | 11   |
| `docs/setup.md`                         | The four env variables, pointing at §7                      | 11   |
| `docs/contributing.md`                  | One line on testing AI services with a fake                 | 11   |

**Deliberately not created:** no `ai_summary` table, no `draft_task` table, no new task status, **no migration**. The schema already carries `ai_run`, `task.ai_run_id`, `message.ai_run_id` and `channel.kind = 'ai'`.

---

## 6. Tasks

### Task 1: Config, provider module, and the `CompletionFn` seam

**Files:**

- Create: `backend/src/config/ai.ts`
- Create: `backend/src/lib/ai/client.ts`
- Create: `backend/src/lib/ai/client.test.ts`
- Modify: `.env.example`
- Modify: `package.json` (root — add the dependency to `backend`)

**Interfaces:**

- Consumes: nothing.
- Produces: `type CompletionFn = (prompt: string) => Promise<string>`; `geminiComplete: CompletionFn`; `aiConfig(): AiConfig`; `AiDisabledError`, `AiQuotaError`.

- [ ] **Step 1: Install the SDK**

```bash
npm install @google/genai --workspace @ctp/backend
```

- [ ] **Step 2: Write the failing test**

Create `backend/src/lib/ai/client.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { AiDisabledError, AiQuotaError, makeGeminiComplete } from "./client.js";

describe("makeGeminiComplete", () => {
  it("throws AiDisabledError when no key is configured", async () => {
    const complete = makeGeminiComplete({
      enabled: false,
      apiKey: "",
      model: "m",
      dailyRunCap: 50,
    });
    await expect(complete("hi")).rejects.toBeInstanceOf(AiDisabledError);
  });

  it("returns the model's text", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '{"ok":true}' });
    const complete = makeGeminiComplete(
      { enabled: true, apiKey: "k", model: "gemini-2.5-flash", dailyRunCap: 50 },
      { models: { generateContent } },
    );
    await expect(complete("hi")).resolves.toBe('{"ok":true}');
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-2.5-flash", contents: "hi" }),
    );
  });

  it("maps a 429 from the provider to AiQuotaError", async () => {
    const generateContent = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("quota"), { status: 429 }));
    const complete = makeGeminiComplete(
      { enabled: true, apiKey: "k", model: "m", dailyRunCap: 50 },
      { models: { generateContent } },
    );
    await expect(complete("hi")).rejects.toBeInstanceOf(AiQuotaError);
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
 * AI is opt-in per deployment (R14, §4 of the plan): free-tier prompts leave
 * Monash infrastructure, so the flag defaults to OFF and every environment
 * turns it on deliberately.
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
 * The seam. Services take one of these as a parameter rather than importing a
 * provider, so unit tests pass a fake and `npm run test:unit` never touches the
 * network. Swapping Gemini for another provider is a change to this file only.
 */
export type CompletionFn = (prompt: string) => Promise<string>;

export class AiDisabledError extends Error {
  constructor(message = "The assistant is not enabled on this deployment.") {
    super(message);
    this.name = "AiDisabledError";
  }
}

export class AiQuotaError extends Error {
  constructor(message = "The assistant has hit its usage limit. Try again later.") {
    super(message);
    this.name = "AiQuotaError";
  }
}

/** The slice of the SDK we use, so tests can supply a double without the network. */
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

> **Verify before merging:** confirm `@google/genai`'s call shape against its README — `ai.models.generateContent({ model, contents })` returning `{ text }` is correct for v2.x, but check the installed version. The `GenAiLike` type localises any fix to this one file.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run backend/src/lib/ai/client.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Document the variables in `.env.example`**

Append:

```bash
# ── Assistant (R15) ──────────────────────────────────────────────────────────
# OFF by default and opt-in per deployment, because free-tier prompts LEAVE
# Monash infrastructure: Google may retain and train on Google AI Studio
# free-tier inputs. See docs/superpowers/plans/2026-09-18-ai-integration.md §4
# before enabling this anywhere real.
AI_ENABLED=
# Google AI Studio key (aistudio.google.com → Get API key). Free tier, no card.
GEMINI_API_KEY=
# Free-tier model id — verify the current one in AI Studio; these names change.
GEMINI_MODEL=gemini-2.5-flash
# Max assistant runs per member per rolling 24h. Guards the shared free quota.
AI_DAILY_RUN_CAP=50
```

- [ ] **Step 8: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run test:unit
git add backend/src/config/ai.ts backend/src/lib/ai .env.example package.json package-lock.json backend/package.json
git commit -m "feat(ai): add Gemini client behind an injectable completion seam"
```

---

### Task 2: Shared zod schemas

**Files:**

- Create: `shared/src/schemas/ai/ai.ts`
- Create: `shared/src/schemas/ai/ai.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**

- Consumes: `taskStatusSchema`, `taskPrioritySchema`, `taskSchema` from `../task/task.js`.
- Produces: `aiTaskSearchRequestSchema`/`AiTaskSearchRequest`, `aiTaskFilterSchema`/`AiTaskFilter`, `aiTaskSearchResponseSchema`/`AiTaskSearchResponse`, `aiThreadSummarySchema`/`AiThreadSummary`, `aiDraftTaskSchema`/`AiDraftTask`, `aiEventPlanRequestSchema`/`AiEventPlanRequest`, `aiEventPlanResponseSchema`/`AiEventPlanResponse`.

- [ ] **Step 1: Write the failing test**

Create `shared/src/schemas/ai/ai.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { aiDraftTaskSchema, aiTaskFilterSchema, aiThreadSummarySchema } from "./ai.js";

describe("aiTaskFilterSchema", () => {
  it("accepts a names-only filter", () => {
    const parsed = aiTaskFilterSchema.parse({
      assigneeName: "Alice",
      status: "todo",
      overdue: true,
    });
    expect(parsed).toEqual({ assigneeName: "Alice", status: "todo", overdue: true });
  });

  it("rejects a uuid smuggled in as a name — the model must never emit ids", () => {
    expect(
      aiTaskFilterSchema.safeParse({ assigneeName: "018f3a4b-0000-7000-8000-00000000000a" })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(aiTaskFilterSchema.safeParse({ status: "archived" }).success).toBe(false);
  });
});

describe("aiDraftTaskSchema", () => {
  it("keeps due dates as offsets, never absolute", () => {
    const parsed = aiDraftTaskSchema.parse({
      title: "Book venue",
      priority: "high",
      dueOffsetDays: -14,
    });
    expect(parsed.dueOffsetDays).toBe(-14);
    expect(parsed.teamName).toBeNull();
  });

  it("rejects an offset outside the planning window", () => {
    expect(
      aiDraftTaskSchema.safeParse({ title: "x", priority: "low", dueOffsetDays: -400 }).success,
    ).toBe(false);
  });
});

describe("aiThreadSummarySchema", () => {
  it("caps the bullet count so one runaway response cannot flood the UI", () => {
    const bullets = Array.from({ length: 9 }, (_, index) => `point ${index}`);
    expect(aiThreadSummarySchema.safeParse({ summary: bullets, actionItems: [] }).success).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run shared/src/schemas/ai/ai.test.ts`
Expected: FAIL — `Cannot find module './ai.js'`.

- [ ] **Step 3: Write `shared/src/schemas/ai/ai.ts`**

```typescript
import { z } from "zod";
import { taskPrioritySchema, taskSchema, taskStatusSchema } from "../task/task.js";

/**
 * Assistant contracts (R15, and R7's natural-language search).
 *
 * THE MODEL NEVER EMITS AN IDENTIFIER. Every schema here that the model fills in
 * takes human-readable names, which the backend resolves against real rows. A
 * hallucinated name is a helpful "no member called Sam"; a hallucinated UUID
 * would be a 422 or, worse, a silent empty result.
 */

/** A name the model may produce: free text, never a uuid. */
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !z.uuid().safeParse(value).success, {
    message: "Names only — the model must not emit identifiers",
  });

// ── A2: natural-language task search ─────────────────────────────────────────

export const aiTaskSearchRequestSchema = z.object({
  q: z.string().trim().min(1, "Type what you are looking for").max(200),
});

export type AiTaskSearchRequest = z.infer<typeof aiTaskSearchRequestSchema>;

/**
 * What the MODEL returns. Deliberately not `listTasksQuerySchema`: that one is
 * all uuids, and `overdue` is not one of its fields because overdue is derived
 * and served by its own endpoint (docs/api-endpoints.md).
 */
export const aiTaskFilterSchema = z.object({
  assigneeName: nameSchema.nullish(),
  teamName: nameSchema.nullish(),
  eventTitle: nameSchema.nullish(),
  status: taskStatusSchema.nullish(),
  priority: taskPrioritySchema.nullish(),
  overdue: z.boolean().nullish(),
  dueWithinDays: z.number().int().min(1).max(365).nullish(),
});

export type AiTaskFilter = z.infer<typeof aiTaskFilterSchema>;

/**
 * `interpreted` is what the UI shows as chips BEFORE the results, so the member
 * can see what the assistant understood and correct it. `unresolved` names the
 * words that matched no row — far more useful than an empty result list.
 */
export const aiTaskSearchResponseSchema = z.object({
  aiRunId: z.uuid(),
  interpreted: z.array(z.object({ label: z.string(), field: z.string() })),
  unresolved: z.array(z.string()),
  tasks: z.array(taskSchema),
});

export type AiTaskSearchResponse = z.infer<typeof aiTaskSearchResponseSchema>;

// ── A3: thread summary ───────────────────────────────────────────────────────

/** What the MODEL returns. Bounded so one runaway response cannot flood the UI. */
export const aiThreadSummarySchema = z.object({
  summary: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
  actionItems: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(200),
        suggestedAssigneeName: nameSchema.nullish(),
      }),
    )
    .max(10),
});

export type AiThreadSummary = z.infer<typeof aiThreadSummarySchema>;

export const aiThreadSummaryResponseSchema = z.object({
  aiRunId: z.uuid(),
  summary: z.array(z.string()),
  actionItems: z.array(
    z.object({ text: z.string(), suggestedAssigneeName: z.string().nullable() }),
  ),
  /** The newest message the summary covers, so the UI can say how stale it is. */
  asOfMessageId: z.uuid().nullable(),
  messageCount: z.number().int().min(0),
});

export type AiThreadSummaryResponse = z.infer<typeof aiThreadSummaryResponseSchema>;

// ── A1: event -> draft tasks ─────────────────────────────────────────────────

export const aiEventPlanRequestSchema = z.object({
  /** The "regenerate, but ..." box — R15's chat-refine, in one field. */
  note: z.string().trim().max(500).optional(),
});

export type AiEventPlanRequest = z.infer<typeof aiEventPlanRequestSchema>;

/**
 * What the MODEL returns per draft. `dueOffsetDays` is relative to
 * `event.starts_at` and is normally NEGATIVE (work happens before the event).
 * Models are unreliable at date arithmetic; the server converts, in CLUB_TIMEZONE.
 */
export const aiDraftTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  priority: taskPrioritySchema,
  dueOffsetDays: z.number().int().min(-180).max(30),
  teamName: nameSchema.nullish().default(null),
});

export type AiDraftTask = z.infer<typeof aiDraftTaskSchema>;

/** Capped at 20: `POST /api/tasks/bulk` allows 100, but 20 is the most a human will actually review. */
export const aiEventPlanModelSchema = z.object({
  drafts: z.array(aiDraftTaskSchema).min(1).max(20),
});

export const aiEventPlanResponseSchema = z.object({
  aiRunId: z.uuid(),
  eventId: z.uuid(),
  drafts: z.array(
    aiDraftTaskSchema.extend({
      /** Resolved server-side from `dueOffsetDays` + `event.starts_at`. */
      dueAt: z.coerce.date().nullable(),
      teamId: z.uuid().nullable(),
    }),
  ),
  unresolved: z.array(z.string()),
});

export type AiEventPlanResponse = z.infer<typeof aiEventPlanResponseSchema>;
```

- [ ] **Step 4: Export from the barrel**

In `shared/src/index.ts`, add after the `channel` line:

```typescript
export * from "./schemas/ai/ai.js";
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run shared/src/schemas/ai/ai.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run test:unit
git add shared/src/schemas/ai shared/src/index.ts
git commit -m "feat(shared): add assistant request and response schemas"
```

---

### Task 3: AI service foundations — channel, run record, daily cap, JSON parsing

**Files:**

- Create: `backend/src/routes/ai/service.ts`
- Create: `backend/src/routes/ai/service.test.ts`

**Interfaces:**

- Consumes: `CompletionFn`, `AiOutputError` from Task 1; `getDb()`; `newId()`; `aiRuns`, `channels`, `chanMembers` from `../../db/schema/index.js`.
- Produces: `type Tx`, `type Queryable`, `AiOutputError`, `resolveAiChannel(tx, userId)`, `assertUnderDailyCap(db, userId, cap)`, `recordRun(db, args)`, `completeJson(complete, prompt, schema)`.

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

  it("fails closed after two bad responses — never a partial write", async () => {
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
import { aiRuns, chanMembers, channels } from "../../db/schema/index.js";
import type * as schema from "../../db/schema/index.js";
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
 * Models wrap JSON in markdown fences no matter how firmly the prompt says not
 * to, and sometimes prefix it with a sentence. Strip both before parsing rather
 * than burning a retry on a response that was actually correct.
 */
export function extractJson(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(raw);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

/**
 * The one place model output becomes typed data. Two attempts, then fail closed:
 * a 422 the member can act on beats a half-applied guess.
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
 * first use. Three CHECK constraints apply: name must be non-blank, min_tier
 * must stay 0, and both parents must be NULL.
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
 * The free tier has a shared quota, so one member running the planner in a loop
 * would break the demo for everyone. Counted off ai_run — no extra table.
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

### Task 4: A2 backend — natural-language task search

**Files:**

- Modify: `backend/src/routes/ai/service.ts`
- Modify: `backend/src/routes/ai/service.test.ts`
- Create: `backend/src/routes/ai/ai.ts`
- Create: `backend/src/routes/ai/ai.integration.test.ts`
- Create: `backend/src/routes/members/service.ts` (extract `readIdentities` — see the note in Step 5)
- Modify: `backend/src/routes/members/members.ts` (import `readIdentities` instead of declaring it)
- Modify: `backend/src/routes/index.ts`

**Interfaces:**

- Consumes: everything from Task 3; `aiTaskFilterSchema`, `aiTaskSearchRequestSchema` from `@ctp/shared`; `readIdentities(db)` returning `{ id: string; name: string; email: string }[]`, extracted in this task.
- Produces: `buildTaskSearchPrompt(q, roster)`, `resolveTaskFilter(roster, filter)` returning `{ query, overdue, interpreted, unresolved }`, and `aiRouter`.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/routes/ai/service.test.ts`:

```typescript
import { resolveTaskFilter } from "./service.js";

const roster = {
  members: [{ id: "018f3a4b-0000-7000-8000-00000000000a", name: "Alice Tan" }],
  teams: [{ id: "018f3a4b-0000-7000-8000-0000000000a1", name: "Marketing" }],
  events: [{ id: "018f3a4b-0000-7000-8000-0000000000e1", title: "O-Week Booth" }],
};

describe("resolveTaskFilter", () => {
  it("resolves names to ids case-insensitively", () => {
    const result = resolveTaskFilter(roster, { assigneeName: "alice tan", teamName: "MARKETING" });
    expect(result.query.assignee).toBe(roster.members[0]!.id);
    expect(result.query.teamId).toBe(roster.teams[0]!.id);
    expect(result.unresolved).toEqual([]);
  });

  it("matches on a partial name, because members type first names", () => {
    expect(resolveTaskFilter(roster, { assigneeName: "Alice" }).query.assignee).toBe(
      roster.members[0]!.id,
    );
  });

  it("reports a name that matches nothing instead of silently returning everything", () => {
    const result = resolveTaskFilter(roster, { assigneeName: "Sam" });
    expect(result.query.assignee).toBeUndefined();
    expect(result.unresolved).toEqual(["Sam"]);
  });

  it("flags overdue so the route picks the overdue endpoint's query", () => {
    expect(resolveTaskFilter(roster, { overdue: true }).overdue).toBe(true);
  });

  it("passes enums straight through and labels them for the chip row", () => {
    const result = resolveTaskFilter(roster, { status: "todo", priority: "urgent" });
    expect(result.query.status).toBe("todo");
    expect(result.interpreted).toContainEqual({ field: "status", label: "todo" });
    expect(result.interpreted).toContainEqual({ field: "priority", label: "urgent" });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run backend/src/routes/ai/service.test.ts`
Expected: FAIL — `resolveTaskFilter is not exported`.

- [ ] **Step 3: Add the resolver and prompt builder to `service.ts`**

```typescript
import type { AiTaskFilter, ListTasksQuery, TaskPriority, TaskStatus } from "@ctp/shared";

export type Roster = {
  members: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  events: { id: string; title: string }[];
};

export type ResolvedTaskFilter = {
  query: Partial<ListTasksQuery> & { status?: TaskStatus; priority?: TaskPriority };
  overdue: boolean;
  dueWithinDays?: number;
  interpreted: { field: string; label: string }[];
  unresolved: string[];
};

/** Exact match first, then a unique prefix/substring — members type "Alice", not "Alice Tan". */
function matchByName<T extends { id: string }>(
  rows: T[],
  label: (row: T) => string,
  needle: string,
): T | undefined {
  const wanted = needle.trim().toLowerCase();
  const exact = rows.find((row) => label(row).toLowerCase() === wanted);
  if (exact) return exact;
  const partial = rows.filter((row) => label(row).toLowerCase().includes(wanted));
  return partial.length === 1 ? partial[0] : undefined;
}

/**
 * The model gave us names; this turns them into the ids the real /tasks query
 * needs. Pure, so it is unit-tested with no database and no network — and a
 * name that matches nothing becomes a message rather than an empty result.
 */
export function resolveTaskFilter(roster: Roster, filter: AiTaskFilter): ResolvedTaskFilter {
  const query: ResolvedTaskFilter["query"] = {};
  const interpreted: { field: string; label: string }[] = [];
  const unresolved: string[] = [];

  if (filter.assigneeName) {
    const member = matchByName(roster.members, (row) => row.name, filter.assigneeName);
    if (member) {
      query.assignee = member.id;
      interpreted.push({ field: "assignee", label: member.name });
    } else unresolved.push(filter.assigneeName);
  }

  if (filter.teamName) {
    const team = matchByName(roster.teams, (row) => row.name, filter.teamName);
    if (team) {
      query.teamId = team.id;
      interpreted.push({ field: "team", label: team.name });
    } else unresolved.push(filter.teamName);
  }

  if (filter.eventTitle) {
    const event = matchByName(roster.events, (row) => row.title, filter.eventTitle);
    if (event) {
      query.eventId = event.id;
      interpreted.push({ field: "event", label: event.title });
    } else unresolved.push(filter.eventTitle);
  }

  if (filter.status) {
    query.status = filter.status;
    interpreted.push({ field: "status", label: filter.status });
  }
  if (filter.priority) {
    query.priority = filter.priority;
    interpreted.push({ field: "priority", label: filter.priority });
  }

  const overdue = filter.overdue === true;
  if (overdue) interpreted.push({ field: "overdue", label: "overdue" });
  if (filter.dueWithinDays) {
    interpreted.push({ field: "due", label: `due within ${filter.dueWithinDays} days` });
  }

  return {
    query,
    overdue,
    dueWithinDays: filter.dueWithinDays ?? undefined,
    interpreted,
    unresolved,
  };
}

export function buildTaskSearchPrompt(q: string, roster: Roster): string {
  return [
    "Convert the member's request into a task filter for a university club's task board.",
    "Reply with ONE JSON object and nothing else. No markdown, no commentary.",
    "",
    "Fields (omit any that do not apply):",
    "  assigneeName, teamName, eventTitle: string — copy a name from the lists below VERBATIM.",
    '  status: "todo" | "in_progress" | "blocked" | "done"',
    '  priority: "low" | "medium" | "high" | "urgent"',
    "  overdue: boolean — true only if they asked for late/overdue work",
    "  dueWithinDays: integer 1-365",
    "",
    "Never invent a name that is not listed. Never output an id or UUID.",
    "",
    `Members: ${roster.members.map((row) => row.name).join(", ") || "(none)"}`,
    `Teams: ${roster.teams.map((row) => row.name).join(", ") || "(none)"}`,
    `Events: ${roster.events.map((row) => row.title).join(", ") || "(none)"}`,
    "",
    `Request: ${q}`,
  ].join("\n");
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run backend/src/routes/ai/service.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Write the route in `backend/src/routes/ai/ai.ts`**

```typescript
import {
  aiTaskFilterSchema,
  aiTaskSearchRequestSchema,
  type AiTaskSearchRequest,
} from "@ctp/shared";
import { and, asc, eq, isNotNull, lt, ne, sql, type SQL } from "drizzle-orm";
import { Router, type Response } from "express";
import { aiConfig } from "../../config/ai.js";
import { getDb } from "../../db/client.js";
import { appUsers, events, tasks, teams } from "../../db/schema/index.js";
import { AiDisabledError, AiQuotaError, geminiComplete } from "../../lib/ai/client.js";
import { authenticate, authorise, validate } from "../../middleware/index.js";
// Extracted from members.ts in this task — see the note below.
import { readIdentities } from "../members/service.js";
import {
  AiOutputError,
  buildTaskSearchPrompt,
  completeJson,
  assertUnderDailyCap,
  recordRun,
  resolveTaskFilter,
  type Roster,
} from "./service.js";

export const aiRouter = Router();

/** One mapping for every AI endpoint, so the three routes stay thin. */
function failure(res: Response, error: unknown): boolean {
  if (error instanceof AiDisabledError) {
    res.status(503).json({ error: { code: "AI_DISABLED", message: error.message } });
    return true;
  }
  if (error instanceof AiQuotaError) {
    res.status(429).json({ error: { code: "AI_QUOTA_EXCEEDED", message: error.message } });
    return true;
  }
  if (error instanceof AiOutputError) {
    res.status(422).json({ error: { code: "AI_OUTPUT_INVALID", message: error.message } });
    return true;
  }
  return false;
}

/** Names only — this is what the model is allowed to see of the club. */
async function loadRoster(db: ReturnType<typeof getDb>): Promise<Roster> {
  const [identities, memberRows, teamRows, eventRows] = await Promise.all([
    readIdentities(db),
    db.select({ id: appUsers.id, authUserId: appUsers.authUserId }).from(appUsers).limit(100),
    db.select({ id: teams.id, name: teams.name }).from(teams).limit(50),
    db
      .select({ id: events.id, title: events.title })
      .from(events)
      .where(ne(events.status, "cancelled"))
      .orderBy(asc(events.startsAt))
      .limit(50),
  ]);
  const members = memberRows
    .map((row) => ({
      id: row.id,
      name: identities.find((identity) => identity.id === row.authUserId)?.name ?? "",
    }))
    // A member with no name is noise in the prompt and unmatchable in the reply.
    .filter((row) => row.name.length > 0);
  return { members, teams: teamRows, events: eventRows };
}

// ── POST /api/ai/task-search ─────────────────────────────────────────────────

aiRouter.post(
  "/ai/task-search",
  authenticate,
  authorise(0),
  validate(aiTaskSearchRequestSchema, "body"),
  async (req, res, next) => {
    try {
      const { q } = res.locals.validated as AiTaskSearchRequest;
      const config = aiConfig();
      if (!config.enabled) throw new AiDisabledError();

      const db = getDb();
      const userId = req.user!.id;
      await assertUnderDailyCap(db, userId, config.dailyRunCap);

      const roster = await loadRoster(db);
      const startedAt = Date.now();
      const filter = await completeJson(
        geminiComplete,
        buildTaskSearchPrompt(q, roster),
        aiTaskFilterSchema,
      );
      const resolved = resolveTaskFilter(roster, filter);

      const conditions: (SQL | undefined)[] = [
        resolved.query.eventId ? eq(tasks.eventId, resolved.query.eventId) : undefined,
        resolved.query.teamId ? eq(tasks.teamId, resolved.query.teamId) : undefined,
        resolved.query.assignee ? eq(tasks.assignee, resolved.query.assignee) : undefined,
        resolved.query.status ? eq(tasks.status, resolved.query.status) : undefined,
        resolved.query.priority ? eq(tasks.priority, resolved.query.priority) : undefined,
        // D8: overdue is derived, exactly as GET /api/tasks/overdue derives it.
        resolved.overdue ? ne(tasks.status, "done") : undefined,
        resolved.overdue ? isNotNull(tasks.dueAt) : undefined,
        resolved.overdue ? lt(tasks.dueAt, sql`now()`) : undefined,
        resolved.dueWithinDays
          ? lt(tasks.dueAt, sql`now() + make_interval(days => ${resolved.dueWithinDays})`)
          : undefined,
      ];

      const rows = await db
        .select()
        .from(tasks)
        .where(and(...conditions.filter((clause): clause is SQL => clause !== undefined)))
        .orderBy(asc(tasks.dueAt))
        .limit(50);

      const aiRunId = await db.transaction((tx) =>
        recordRun(tx, {
          userId,
          prompt: q,
          steps: [
            { tool: "task-search", ms: Date.now() - startedAt, detail: { results: rows.length } },
          ],
        }),
      );

      res.json({
        aiRunId,
        interpreted: resolved.interpreted,
        unresolved: resolved.unresolved,
        tasks: rows,
      });
    } catch (error) {
      if (!failure(res, error)) next(error);
    }
  },
);
```

> **`readIdentities` must be extracted first.** `app_user` deliberately stores neither name nor email; real names live in `auth."user"` and are read by `readIdentities()`, currently a **private function** in `backend/src/routes/members/members.ts:38`. Extract it to a new `backend/src/routes/members/service.ts` and import it from both `members.ts` and `ai.ts`. Do not copy the query, and do **not** try to make this tidier by adding `name`/`email` to the `authUser` declaration in `schema/auth.ts` — the comment above `readIdentities` records that this was tried and reverted: drizzle-kit still diffs columns on a table we declare, so `db:generate` emits `ALTER TABLE auth."user" ADD COLUMN "name"` against columns Better Auth already created, and that migration fails on every database it touches. Raw SQL here is deliberate.
>
> Fold the extraction into this task's Step 3 and include `backend/src/routes/members/` in its commit. `members.integration.test.ts` must still pass unchanged — that is the check that the extraction was behaviour-preserving.

- [ ] **Step 6: Register the router**

In `backend/src/routes/index.ts`, import `aiRouter` and add `apiRouter.use(aiRouter);` immediately before the `exampleRouter` line.

- [ ] **Step 7: Write the integration test**

Create `backend/src/routes/ai/ai.integration.test.ts`, following the fixture pattern in `backend/src/routes/tasks/tasks.integration.test.ts` (same `getSession` hoisted mock and `member()` / `signedInAs()` helpers — copy them, they are per-suite by design). Add:

```typescript
const complete = vi.hoisted(() => vi.fn());
vi.mock("../../lib/ai/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/ai/client.js")>();
  return { ...actual, geminiComplete: complete };
});

describe("POST /api/ai/task-search", () => {
  beforeEach(() => {
    process.env.AI_ENABLED = "1";
    process.env.GEMINI_API_KEY = "test-key";
    complete.mockReset();
  });

  it("503s when the assistant is disabled", async () => {
    process.env.AI_ENABLED = "";
    signedInAs(officer);
    const response = await request(app).post("/api/ai/task-search").send({ q: "my tasks" });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("AI_DISABLED");
  });

  it("422s and writes nothing when the model returns junk twice", async () => {
    complete.mockResolvedValue("I'm afraid I can't do that");
    signedInAs(officer);
    const response = await request(app).post("/api/ai/task-search").send({ q: "???" });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("AI_OUTPUT_INVALID");
    const runs = await db.select().from(aiRuns);
    expect(runs).toHaveLength(0);
  });

  it("filters by the resolved status and records one ai_run", async () => {
    complete.mockResolvedValue('{"status":"todo"}');
    signedInAs(officer);
    const response = await request(app)
      .post("/api/ai/task-search")
      .send({ q: "what is not started" });
    expect(response.status).toBe(200);
    expect(response.body.tasks.every((task: { status: string }) => task.status === "todo")).toBe(
      true,
    );
    expect(response.body.interpreted).toContainEqual({ field: "status", label: "todo" });
    const runs = await db.select().from(aiRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.costMicroUsd).toBe(0);
  });

  it("names what it could not resolve rather than returning everything", async () => {
    complete.mockResolvedValue('{"assigneeName":"Nobody"}');
    signedInAs(officer);
    const response = await request(app).post("/api/ai/task-search").send({ q: "nobody's tasks" });
    expect(response.body.unresolved).toEqual(["Nobody"]);
  });
});
```

- [ ] **Step 8: Run the integration suite**

Run: `npm run test:integration -- --run src/routes/ai`
Expected: PASS, 4 tests. (Docker Postgres must be up and migrated — `docs/setup.md`.)

- [ ] **Step 9: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run test:integration
git add backend/src/routes/ai backend/src/routes/members backend/src/routes/index.ts
git commit -m "feat(ai): add natural-language task search (R7, US-16)"
```

---

### Task 5: A2 frontend — search box and interpreted chips

**Files:**

- Create: `frontend/src/hooks/use-ai-task-search.ts`
- Create: `frontend/src/components/ai-filter-chips.tsx`
- Create: `frontend/src/components/ai-filter-chips.test.tsx`
- Modify: `frontend/src/routes/tasks.tsx`

**Interfaces:**

- Consumes: `aiTaskSearchResponseSchema`, `type AiTaskSearchResponse`, `type Task` from `@ctp/shared`.
- Produces: `useAiTaskSearch()` returning `{ state, search, clear }` where `state` is `{ status: "idle" } | { status: "loading" } | { status: "ok"; result: AiTaskSearchResponse } | { status: "error"; message: string }`.

- [ ] **Step 1: Write the failing component test**

Create `frontend/src/components/ai-filter-chips.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AiFilterChips } from "./ai-filter-chips.js";

describe("AiFilterChips", () => {
  it("shows what the assistant understood, so a wrong reading is visible before the results", () => {
    render(
      <AiFilterChips
        interpreted={[{ field: "status", label: "todo" }]}
        unresolved={[]}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText("status: todo")).toBeInTheDocument();
  });

  it("warns about names it could not match", () => {
    render(<AiFilterChips interpreted={[]} unresolved={["Sam"]} onRemove={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Sam");
  });

  it("removes a chip by keyboard — R13/US-21", async () => {
    const onRemove = vi.fn();
    render(
      <AiFilterChips
        interpreted={[{ field: "status", label: "todo" }]}
        unresolved={[]}
        onRemove={onRemove}
      />,
    );
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(onRemove).toHaveBeenCalledWith("status");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run frontend/src/components/ai-filter-chips.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the chips component**

Use the shadcn `Button` (`frontend/src/components/ui/button.tsx`) with `variant="secondary"` and `size="sm"` for each chip — **do not hand-roll a clickable `span`**. `CLAUDE.md`'s shadcn-first rule exists because that is where keyboard nav and ARIA come from (R14, US-21). The unresolved notice is a `<p role="status">` so a screen reader announces it without stealing focus.

```tsx
import { Button } from "./ui/button.js";

type Props = {
  interpreted: { field: string; label: string }[];
  unresolved: string[];
  onRemove: (field: string) => void;
};

/**
 * The assistant's reading of the request, shown BEFORE the results so a wrong
 * interpretation is obvious and correctable rather than silently wrong.
 */
export function AiFilterChips({ interpreted, unresolved, onRemove }: Props) {
  if (interpreted.length === 0 && unresolved.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {interpreted.map((chip) => (
        <Button
          key={chip.field}
          variant="secondary"
          size="sm"
          onClick={() => onRemove(chip.field)}
          aria-label={`Remove filter ${chip.field}: ${chip.label}`}
        >
          {chip.field}: {chip.label} <span aria-hidden="true">x</span>
        </Button>
      ))}
      {unresolved.length > 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          No match for {unresolved.join(", ")}.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write the hook**

Create `frontend/src/hooks/use-ai-task-search.ts` following the `use-tasks.ts` pattern exactly — plain `fetch`, `credentials: "include"`, response parsed with the shared schema, state as a discriminated union. Map a 503 to "The assistant is turned off." and a 429 to "The assistant has hit today's limit." so the member sees something actionable rather than "Failed to fetch".

- [ ] **Step 5: Wire it into `frontend/src/routes/tasks.tsx`**

Add an `<Input>` above the task list with a label of "Ask for tasks", render `<AiFilterChips>` beneath it, and show the returned `tasks` in place of the default list while `state.status === "ok"`. Keep `routes/` declarative — all fetching stays in the hook (MVVM, `CLAUDE.md`).

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run frontend/src/components/ai-filter-chips.test.tsx frontend/src/routes/tasks.test.tsx`
Expected: PASS.

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run test:unit
git add frontend/src/hooks/use-ai-task-search.ts frontend/src/components/ai-filter-chips.tsx frontend/src/components/ai-filter-chips.test.tsx frontend/src/routes/tasks.tsx
git commit -m "feat(frontend): add assistant task search with interpreted filter chips"
```

---

### Task 6: A3 backend — thread summary

**Files:**

- Modify: `backend/src/routes/ai/service.ts`
- Modify: `backend/src/routes/ai/service.test.ts`
- Modify: `backend/src/routes/ai/ai.ts`
- Modify: `backend/src/routes/ai/ai.integration.test.ts`

**Interfaces:**

- Consumes: Task 3 foundations; `aiThreadSummarySchema` from `@ctp/shared`; the channel-visibility helper already used by `backend/src/routes/threads/threads.ts`.
- Produces: `budgetMessages(messages, maxChars)`, `buildSummaryPrompt(messages)`, and `POST /api/ai/threads/:id/summary`.

- [ ] **Step 1: Write the failing test**

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
    const input = [message("1", "hello"), message("2", "world")];
    expect(budgetMessages(input, 1000)).toHaveLength(2);
  });

  it("drops the OLDEST first — recent context matters most in a thread", () => {
    const input = [
      message("1", "a".repeat(60)),
      message("2", "b".repeat(60)),
      message("3", "c".repeat(60)),
    ];
    const kept = budgetMessages(input, 140);
    expect(kept.map((row) => row.id)).toEqual(["2", "3"]);
  });

  it("truncates a single oversized message rather than dropping the whole thread", () => {
    const kept = budgetMessages([message("1", "x".repeat(500))], 100);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.body.length).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run backend/src/routes/ai/service.test.ts`
Expected: FAIL — `budgetMessages is not exported`.

- [ ] **Step 3: Add the budgeter and prompt builder to `service.ts`**

```typescript
export type PromptMessage = { id: string; author: string; body: string; createdAt: Date };

/** Free-tier context windows are small, and one pasted wall of text otherwise
 * blows the request. Budget by CHARACTERS, not message count — oldest dropped
 * first, because the recent end of a thread is what a catch-up needs. */
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

- [ ] **Step 4: Add the route to `ai.ts`**

Constants: `const SUMMARY_MESSAGE_LIMIT = 100;` and `const SUMMARY_CHAR_BUDGET = 12000;`.

The handler must, in order: reject when disabled; check the daily cap; **reuse the threads route's existing channel-visibility check** so a member cannot summarise a channel they cannot read (if that logic is inline in `threads.ts`, extract it to `routes/threads/service.ts` as `assertCanReadChannel(db, channelId, user)` and import it from both — do not copy it); load the newest `SUMMARY_MESSAGE_LIMIT` messages; `budgetMessages`; `completeJson(... aiThreadSummarySchema)`; `recordRun`; respond with `asOfMessageId` set to the newest message's id.

Add an in-process cache keyed on `` `${channelId}:${newestMessageId}` `` with a `Map`, so reopening the tab does not spend a call. Cap it at 50 entries and evict the oldest — it is a convenience, not a correctness mechanism, and a serverless cold start legitimately empties it.

- [ ] **Step 5: Add integration tests**

Cover: 200 with bullets on a thread the member can read; 403 on a channel they cannot; 422 when the model returns junk twice; and a second identical request served from cache with `complete` called only once.

- [ ] **Step 6: Run the suites**

Run: `npx vitest run backend/src/routes/ai/service.test.ts && npm run test:integration -- --run src/routes/ai`
Expected: PASS.

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run test:integration
git add backend/src/routes/ai backend/src/routes/threads
git commit -m "feat(ai): add thread summaries (R9)"
```

---

### Task 7: A3 frontend — summary panel

**Files:**

- Create: `frontend/src/hooks/use-thread-summary.ts`
- Create: `frontend/src/components/thread-summary-panel.tsx`
- Create: `frontend/src/components/thread-summary-panel.test.tsx`
- Modify: `frontend/src/routes/event-detail.tsx`

**Interfaces:**

- Consumes: `aiThreadSummaryResponseSchema`, `type AiThreadSummaryResponse` from `@ctp/shared`.
- Produces: `useThreadSummary(threadId)` returning `{ state, summarise }`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThreadSummaryPanel } from "./thread-summary-panel.js";

describe("ThreadSummaryPanel", () => {
  it("renders bullets as a list, not paragraphs — R13 structure", () => {
    render(
      <ThreadSummaryPanel
        state={{
          status: "ok",
          result: {
            aiRunId: "018f3a4b-0000-7000-8000-00000000000a",
            summary: ["Venue booked"],
            actionItems: [],
            asOfMessageId: null,
            messageCount: 3,
          },
        }}
        onSummarise={() => {}}
      />,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent("Venue booked");
  });

  it("marks the panel as AI-generated so nobody mistakes it for a member's words", () => {
    render(<ThreadSummaryPanel state={{ status: "idle" }} onSummarise={() => {}} />);
    expect(screen.getByText(/AI-generated/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run frontend/src/components/thread-summary-panel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the panel**

Use the shadcn `Card` for the container and `Button` for "Summarise thread". Render `summary` as a `<ul>`, `actionItems` as a second `<ul>`. Include the literal text "AI-generated — check before acting" in the card footer: it is the honest framing, and it is what stops a summary being quoted as if a member wrote it. When `messageCount` exceeds what was summarised, show "covers the last N messages".

- [ ] **Step 4: Write the hook and mount it on the event-detail Thread tab**

- [ ] **Step 5: Run the tests, verify and commit**

```bash
npm run typecheck && npm run lint && npm run test:unit
git add frontend/src/hooks/use-thread-summary.ts frontend/src/components/thread-summary-panel.tsx frontend/src/components/thread-summary-panel.test.tsx frontend/src/routes/event-detail.tsx
git commit -m "feat(frontend): add thread summary panel"
```

---

### Task 8: A1 backend — event to draft tasks

**Files:**

- Modify: `backend/src/routes/ai/service.ts`
- Modify: `backend/src/routes/ai/service.test.ts`
- Modify: `backend/src/routes/ai/ai.ts`
- Modify: `backend/src/routes/ai/ai.integration.test.ts`

**Interfaces:**

- Consumes: Task 3 foundations; `aiEventPlanModelSchema`, `aiEventPlanRequestSchema` from `@ctp/shared`; `CLUB_TIMEZONE` from `../../config/club.js`; `visibleEvents(tier)` from `../events/service.js`.
- Produces: `pastEventCorpus(db, limit)`, `buildEventPlanPrompt(event, corpus, teamNames, note)`, `resolveDrafts(drafts, startsAt, teams)`, and `POST /api/ai/events/:id/plan`.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/routes/ai/service.test.ts`:

```typescript
import { resolveDrafts } from "./service.js";

describe("resolveDrafts", () => {
  const startsAt = new Date("2026-10-01T09:00:00Z");
  const teamRows = [{ id: "018f3a4b-0000-7000-8000-0000000000a1", name: "Marketing" }];

  it("converts a negative offset into a due date before the event", () => {
    const { drafts } = resolveDrafts(
      [{ title: "Book venue", priority: "high", dueOffsetDays: -14, teamName: null }],
      startsAt,
      teamRows,
    );
    expect(drafts[0]!.dueAt?.toISOString()).toBe("2026-09-17T09:00:00.000Z");
  });

  it("resolves a team name to an id", () => {
    const { drafts } = resolveDrafts(
      [{ title: "Posters", priority: "medium", dueOffsetDays: -7, teamName: "Marketing" }],
      startsAt,
      teamRows,
    );
    expect(drafts[0]!.teamId).toBe(teamRows[0]!.id);
  });

  it("keeps a draft whose team is unknown, and reports the name", () => {
    const { drafts, unresolved } = resolveDrafts(
      [{ title: "Catering", priority: "low", dueOffsetDays: -3, teamName: "Logistics" }],
      startsAt,
      teamRows,
    );
    expect(drafts[0]!.teamId).toBeNull();
    expect(drafts).toHaveLength(1);
    expect(unresolved).toEqual(["Logistics"]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run backend/src/routes/ai/service.test.ts`
Expected: FAIL — `resolveDrafts is not exported`.

- [ ] **Step 3: Add the corpus loader, prompt builder and resolver to `service.ts`**

```typescript
import { desc, lt, ne, and as drizzleAnd } from "drizzle-orm";
import { events as eventsTable, tasks as tasksTable } from "../../db/schema/index.js";

/** How many past events seed the prompt. Small on purpose: free-tier context. */
export const PLAN_CORPUS_EVENTS = 3;

/**
 * Few-shot examples drawn from the club's OWN history — this is what makes the
 * drafts read like this committee's work rather than generic event advice.
 *
 * NOTE: there is no `event.type` column (see §2 of the plan), so the corpus is
 * simply the most recent PAST events. Narrow by type here if one is ever added.
 */
export async function pastEventCorpus(
  db: Queryable,
  limit = PLAN_CORPUS_EVENTS,
): Promise<{ title: string; taskTitles: string[] }[]> {
  const past = await db
    .select({ id: eventsTable.id, title: eventsTable.title })
    .from(eventsTable)
    .where(drizzleAnd(ne(eventsTable.status, "cancelled"), lt(eventsTable.startsAt, sql`now()`)))
    .orderBy(desc(eventsTable.startsAt))
    .limit(limit);

  return Promise.all(
    past.map(async (event) => ({
      title: event.title,
      taskTitles: (
        await db
          .select({ title: tasksTable.title })
          .from(tasksTable)
          .where(eq(tasksTable.eventId, event.id))
          .limit(25)
      ).map((row) => row.title),
    })),
  );
}

export type ResolvedDraft = {
  title: string;
  priority: TaskPriority;
  dueOffsetDays: number;
  teamName: string | null;
  dueAt: Date | null;
  teamId: string | null;
};

/** D11: the model gives offsets, the server does the arithmetic. */
export function resolveDrafts(
  drafts: {
    title: string;
    priority: TaskPriority;
    dueOffsetDays: number;
    teamName?: string | null;
  }[],
  startsAt: Date,
  teamRows: { id: string; name: string }[],
): { drafts: ResolvedDraft[]; unresolved: string[] } {
  const unresolved: string[] = [];
  const resolved = drafts.map((draft) => {
    const team = draft.teamName
      ? matchByName(teamRows, (row) => row.name, draft.teamName)
      : undefined;
    if (draft.teamName && !team && !unresolved.includes(draft.teamName))
      unresolved.push(draft.teamName);
    return {
      title: draft.title,
      priority: draft.priority,
      dueOffsetDays: draft.dueOffsetDays,
      teamName: draft.teamName ?? null,
      dueAt: new Date(startsAt.getTime() + draft.dueOffsetDays * 24 * 60 * 60 * 1000),
      teamId: team?.id ?? null,
    };
  });
  return { drafts: resolved, unresolved };
}

export function buildEventPlanPrompt(
  event: {
    title: string;
    description: string | null;
    venue: string | null;
    startsAt: Date;
    attendanceEstimate: number | null;
  },
  corpus: { title: string; taskTitles: string[] }[],
  teamNames: string[],
  note?: string,
): string {
  return [
    "You help a university club committee plan the work for an upcoming event.",
    "Reply with ONE JSON object and nothing else. No markdown, no commentary.",
    "",
    '{"drafts": [{"title": "...", "priority": "low|medium|high|urgent", "dueOffsetDays": -14, "teamName": "a team name or null"}]}',
    "",
    "dueOffsetDays counts DAYS FROM THE EVENT START: negative is before (almost always), positive is after.",
    "Give 5-12 concrete, assignable tasks. No vague items like 'plan the event'.",
    `Use only these team names, or null: ${teamNames.join(", ") || "(none)"}`,
    "",
    "Upcoming event:",
    `  Title: ${event.title}`,
    `  Starts: ${event.startsAt.toISOString()}`,
    `  Venue: ${event.venue ?? "not set"}`,
    `  Expected attendance: ${event.attendanceEstimate ?? "not set"}`,
    `  Description: ${event.description ?? "none"}`,
    "",
    "How this club ran past events:",
    ...corpus.map(
      (entry) => `  ${entry.title}: ${entry.taskTitles.join("; ") || "(no tasks recorded)"}`,
    ),
    ...(note ? ["", `Extra instruction from the organiser: ${note}`] : []),
  ].join("\n");
}
```

- [ ] **Step 4: Add the route to `ai.ts`**

`POST /api/ai/events/:id/plan`, gated `authenticate, authorise(1), validate(eventParamsSchema, "params"), validate(aiEventPlanRequestSchema, "body")`. Load the event through `visibleEvents(req.user!.tier)` so an event above the caller's tier, or a cancelled one, reads as 404 exactly as it does on every other event route — a different code would confirm the event exists. Then: cap check, corpus, prompt, `completeJson(... aiEventPlanModelSchema)`, `resolveDrafts`, `recordRun`, respond. **Nothing is written to `task`.**

- [ ] **Step 5: Add integration tests**

Cover: 403 for a tier-0 member; 404 for an event the caller cannot see; 200 returning drafts with computed `dueAt` and **zero rows added to `task`**; 422 on junk output.

- [ ] **Step 6: Run the suites, verify and commit**

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run test:integration
git add backend/src/routes/ai
git commit -m "feat(ai): draft an event's task list from past events (R15)"
```

---

### Task 9: Provenance — carry `aiRunId` through the bulk publish

**Files:**

- Modify: `shared/src/schemas/task/task.ts`
- Modify: `shared/src/schemas/task/task.test.ts`
- Modify: `backend/src/routes/tasks/tasks.ts`
- Modify: `backend/src/routes/tasks/tasks.integration.test.ts`

**Interfaces:**

- Consumes: `bulkCreateTasksSchema`.
- Produces: `bulkCreateTasksSchema` with an optional top-level `aiRunId`; the bulk handler stamps it onto every inserted row.

- [ ] **Step 1: Write the failing schema test**

Append to `shared/src/schemas/task/task.test.ts`:

```typescript
it("accepts an aiRunId so published drafts keep their provenance", () => {
  const parsed = bulkCreateTasksSchema.parse({
    aiRunId: "018f3a4b-0000-7000-8000-00000000000a",
    tasks: [{ title: "Book venue" }],
  });
  expect(parsed.aiRunId).toBe("018f3a4b-0000-7000-8000-00000000000a");
});

it("still accepts a bulk create with no aiRunId", () => {
  expect(
    bulkCreateTasksSchema.parse({ tasks: [{ title: "Manual task" }] }).aiRunId,
  ).toBeUndefined();
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run shared/src/schemas/task/task.test.ts`
Expected: FAIL — `aiRunId` is stripped.

- [ ] **Step 3: Extend the schema**

In `shared/src/schemas/task/task.ts`, change `bulkCreateTasksSchema` to:

```typescript
export const bulkCreateTasksSchema = z.object({
  /**
   * Set when this batch was published from an assistant draft, so
   * `task.ai_run_id` records which run produced each row — "which tasks did the
   * assistant create?" (backend/src/db/schema/ai-run.ts). Never invented by the
   * client: it comes straight back from POST /api/ai/events/:id/plan.
   */
  aiRunId: z.uuid().optional(),
  tasks: z.array(createTaskSchema).min(1, "Provide at least one task").max(100),
});
```

- [ ] **Step 4: Stamp it in the bulk handler**

In `backend/src/routes/tasks/tasks.ts`, the bulk insert's `.values(...)` mapping gains `aiRunId: body.aiRunId ?? null`.

> **Watch out:** `task.ai_run_id` is a real FK to `ai_run(id)`. An `aiRunId` that does not exist would 500 from Postgres, so add it to the existing `findBadReference()` check — a `SELECT id FROM ai_run WHERE id = $1`, returning `{ code: "AI_RUN_NOT_FOUND" }` — the same way unknown events, teams and assignees are turned into 422s that name the field.

- [ ] **Step 5: Add an integration test**

Assert that a bulk create with a real `aiRunId` stores it on every row, that omitting it leaves `ai_run_id` NULL, and that an unknown `aiRunId` 422s with `AI_RUN_NOT_FOUND`.

- [ ] **Step 6: Run the suites, verify and commit**

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run test:integration
git add shared/src/schemas/task backend/src/routes/tasks
git commit -m "feat(tasks): record assistant provenance on bulk-created tasks"
```

---

### Task 10: A1 frontend — the review dialog

**Files:**

- Create: `frontend/src/hooks/use-event-plan.ts`
- Create: `frontend/src/components/event-plan-dialog.tsx`
- Create: `frontend/src/components/event-plan-dialog.test.tsx`
- Modify: `frontend/src/routes/event-detail.tsx`

**Interfaces:**

- Consumes: `aiEventPlanResponseSchema`, `type AiEventPlanResponse`, `bulkCreateTasksSchema` from `@ctp/shared`.
- Produces: `useEventPlan(eventId)` returning `{ state, generate, publish }`, where `publish(selected)` POSTs to `/api/tasks/bulk` with the `aiRunId` from the generate response.

- [ ] **Step 1: Add the shadcn dialog**

```bash
npx shadcn@latest add dialog checkbox --cwd frontend
```

`frontend/src/components/ui/` currently has only button, card, form, input, label and sonner. Take the Radix dialog — **do not hand-roll a modal.** Focus trapping, `Escape` handling and `aria-modal` are exactly what R14/US-21 need and exactly what a hand-rolled one gets wrong.

- [ ] **Step 2: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EventPlanDialog } from "./event-plan-dialog.js";

const drafts = [
  {
    title: "Book venue",
    priority: "high" as const,
    dueOffsetDays: -14,
    teamName: null,
    dueAt: new Date("2026-09-17"),
    teamId: null,
  },
  {
    title: "Design posters",
    priority: "medium" as const,
    dueOffsetDays: -7,
    teamName: "Marketing",
    dueAt: new Date("2026-09-24"),
    teamId: "018f3a4b-0000-7000-8000-0000000000a1",
  },
];

describe("EventPlanDialog", () => {
  it("starts with every draft selected but lets one be unticked", async () => {
    const onPublish = vi.fn();
    render(
      <EventPlanDialog
        open
        drafts={drafts}
        unresolved={[]}
        publishing={false}
        onPublish={onPublish}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /Book venue/ }));
    await userEvent.click(screen.getByRole("button", { name: /Create 1 task/ }));
    expect(onPublish).toHaveBeenCalledWith([drafts[1]]);
  });

  it("disables publishing when nothing is selected", async () => {
    render(
      <EventPlanDialog
        open
        drafts={drafts}
        unresolved={[]}
        publishing={false}
        onPublish={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /Book venue/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Design posters/ }));
    expect(screen.getByRole("button", { name: /Create/ })).toBeDisabled();
  });

  it("says the drafts are AI-generated and unsaved until published", () => {
    render(
      <EventPlanDialog
        open
        drafts={drafts}
        unresolved={[]}
        publishing={false}
        onPublish={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/nothing is saved until you create them/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run frontend/src/components/event-plan-dialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Build the dialog**

Every draft starts ticked, with an editable title `Input`, the computed `dueAt` shown as read-only text, and the team name where resolved. Footer button reads `Create N tasks`, disabled at zero and while `publishing`. Include the literal text "These are AI-generated drafts — nothing is saved until you create them." A "Regenerate with a note" `Input` maps to the route's `note` field (R15's chat-refine, in one control).

- [ ] **Step 5: Build the hook**

`publish(selected)` maps each selected draft to `CreateTask` — `{ eventId, teamId, title, priority, dueAt }` — and POSTs `{ aiRunId, tasks }` to `/api/tasks/bulk`. On success, `toast.success` via the existing sonner setup and close.

- [ ] **Step 6: Add the trigger to `event-detail.tsx`**

A "Draft tasks with AI" button on the Tasks tab, rendered only when the member is tier 1+ (mirroring the route's `authorise(1)`) so nobody is shown a button that 403s.

- [ ] **Step 7: Run the tests, verify and commit**

```bash
npm run typecheck && npm run lint && npm run test:unit
git add frontend/src/hooks/use-event-plan.ts frontend/src/components/event-plan-dialog.tsx frontend/src/components/event-plan-dialog.test.tsx frontend/src/components/ui frontend/src/routes/event-detail.tsx
git commit -m "feat(frontend): add AI event plan review dialog (R15)"
```

---

### Task 11: E2E, docs, and the full gate

**Files:**

- Create: `e2e/ai.spec.ts`
- Modify: `docs/api-endpoints.md`, `docs/prd.md`, `docs/architecture.md`, `docs/setup.md`, `docs/contributing.md`

**Interfaces:**

- Consumes: everything above.
- Produces: a green `npm run verify`.

- [ ] **Step 1: Write the E2E spec with AI off**

`e2e/ai.spec.ts` runs with `AI_ENABLED` unset — **the default for E2E.** A rate-limited free tier must never be able to fail CI (`docs/contributing.md` runs `unit` / `integration` / `e2e` as separate jobs so a red check names the bucket; a flaky external dependency would make `e2e` meaningless). Assert:

- the tasks page still loads and the normal list renders;
- the assistant search box either is absent or shows "The assistant is turned off" on submit, never a crash or an infinite spinner;
- the existing axe scan still passes on any new UI that renders while disabled.

- [ ] **Step 2: Run the E2E suite**

Run: `npm run test:e2e`
Expected: PASS.

- [ ] **Step 3: Document the endpoints**

Add a `## AI` section to `docs/api-endpoints.md` after `## Threads`, matching the existing `### METHOD /path · tier N` heading style, with request/response examples for all three endpoints and the three error codes from §5.2.

- [ ] **Step 4: Update the requirement tables**

- `docs/prd.md`: R15 `Deferred / ⬜` → `Deferred / 🟡`, with an as-built note naming what shipped (draft-from-past-events + human approval) and what did not (smart-assign, 👍/👎 history). Add to R7's note that ⌘K search now has an AI path via `POST /api/ai/task-search`. Add a line to R14's note about free-tier data handling, pointing at §4 of this plan.
- `docs/architecture.md`: add `routes/ai/` and `lib/ai/` to the "Where everything lives" map.
- `docs/setup.md`: add the four env variables to the command/env table and point at §7 below.
- `docs/contributing.md`: one line under "Backend unit tests" noting that AI services take a `CompletionFn` and are tested with a fake, never a live key.

- [ ] **Step 5: Run the full gate**

```bash
npm run verify
```

Expected: all six stages pass. Docker Postgres must be up and Playwright browsers installed (`docs/setup.md`).

- [ ] **Step 6: Commit**

```bash
git add e2e/ai.spec.ts docs
git commit -m "docs: document the assistant endpoints and update R7/R14/R15"
```

---

## 7. What you must do on the Google side

Do this **before Task 1, Step 6** — the unit tests pass without a key, but nothing real runs until this is done.

### 7.1 Get the key (Google AI Studio, not Vertex AI)

This is the fork that decides whether it is free:

|           | Google AI Studio             | Vertex AI                  |
| --------- | ---------------------------- | -------------------------- |
| Console   | `aistudio.google.com`        | `console.cloud.google.com` |
| Auth      | A plain API key              | GCP service account + ADC  |
| Billing   | **Not required — free tier** | Billing account required   |
| Use this? | **Yes**                      | No                         |

1. Sign in at **aistudio.google.com** with a Google account. Consider a throwaway or personal account rather than your Monash one, since free-tier prompts may be retained (§4).
2. Click **Get API key** → **Create API key**.
3. It will ask for a Google Cloud project. Either let it create one, or pick an existing one. This silently enables the **Generative Language API** (`generativelanguage.googleapis.com`) on that project — that is the only GCP resource involved.
4. Copy the key. It is shown once.
5. Paste into your local `.env`:
   ```
   AI_ENABLED=1
   GEMINI_API_KEY=<the key>
   GEMINI_MODEL=gemini-2.5-flash
   AI_DAILY_RUN_CAP=50
   ```
   `.env` is already gitignored (`.gitignore:11-13` — `.env`, `.env.*`, with `!.env.example`). **Never commit the key.** If it does get committed, revoke it in AI Studio immediately; rotating is free and instant.

### 7.2 Confirm the model id and the limits

On the AI Studio API-key page, check the current free-tier model list and its rate limits (requests/minute, requests/day). These change, which is exactly why `GEMINI_MODEL` is an env variable. If `gemini-2.5-flash` is not offered on the free tier when you set this up, put whatever the current free Flash-class model is into `GEMINI_MODEL` — **no code change is needed.**

Compare the daily request limit against `AI_DAILY_RUN_CAP=50` per member. With a committee of ~20, fifty each would exceed most free daily quotas if everyone used it hard on the same day. For demo week, drop the cap to 10–15.

### 7.3 Lock the key down (optional, ~2 minutes, worth it)

In **console.cloud.google.com** → **APIs & Services** → **Credentials** → your key → **Restrict key** → **API restrictions** → select only **Generative Language API**. A leaked key then cannot be used against any other Google service on that project.

Do **not** add an HTTP-referrer restriction: the key is used server-side from your backend, not from the browser, so a referrer restriction would break it.

### 7.4 Vercel

Add the same four variables in **Vercel → your project → Settings → Environment Variables**, for Preview and Production. `backend/src/config/load-env.ts` already falls back to platform-provided env when no root `.env` exists, so nothing else changes.

Consider leaving `AI_ENABLED` **unset in Production** until the R14 privacy paragraph (§4) is agreed with your supervisor. Every endpoint 503s cleanly and the UI stays usable — that is what Task 11's E2E spec asserts.

### 7.5 What you do NOT need

No billing account, no credit card, no service account, no `gcloud` CLI, no Vertex AI, no VPC, no IAM roles, no OAuth consent screen. The existing `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env.example` are for Better Auth sign-in (R1) and are **completely unrelated** — do not reuse them, and do not put the Gemini key there.

---

## 8. Risks

| Risk                                                      | Likelihood | Mitigation                                                                                 |
| --------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| Free-tier rate limit hit during the demo                  | High       | `AI_DAILY_RUN_CAP`; 429 renders as a readable message; A3's cache; E2E runs with AI off    |
| `@google/genai` call shape differs from Task 1's sketch   | Medium     | Isolated in `client.ts` behind `GenAiLike`; the three unit tests fail loudly and locally   |
| Model returns prose instead of JSON                       | Medium     | `extractJson` + one retry + `safeParse`; fails to a 422 that never writes                  |
| `event.type` gets added mid-project, changing A1's corpus | Low        | One-line change in `pastEventCorpus()`, flagged in §2                                      |
| Supervisor objects to sending member messages to Google   | Medium     | §4 lists three mitigations in cost order; decide before Task 6                             |
| `readIdentities` extraction regresses `GET /api/members`  | Low        | `members.integration.test.ts` must pass unchanged — that is the behaviour-preserving check |
| Serverless cold start empties A3's cache                  | Certain    | It is a convenience, not correctness — a miss just costs one call                          |

---

## 9. Out of scope

Deliberately not in this plan, and each needs its own brainstorm before anyone starts it: the Tier-B agent chat (tools, `ai_run.steps` traces, the `ai` channel as a page); A5 smart-assign; the 👍/👎 history R15 mentions; AI on the money routes (forbidden by Rule 13); streaming responses; and embeddings or semantic search.
