# AI Assistant — Multiple Chats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single per-member assistant conversation into many chats that remember themselves and keep their drafted plans, shown only in AI Breakdown, with the daily briefing made prominent.

**Architecture:** Each chat is a `channel` of kind `ai` owned by one member (its only `chan_member`). `ai_run` gains `kind`, `result` and `proposal_status`, and its channel link becomes optional, so briefings and summaries are runs with no chat and a drafted plan lives on the run that drafted it. A new framework-free `routes/ai/chats.ts` owns chat rules; `routes/ai/ai.ts` stays the router. The threads service stops treating `ai` as a membership kind, which removes AI chats from every thread route at once. The frontend replaces `useAssistant` with `useAiChats` + `useAiChat` and rebuilds `/ai` as a two-column page modelled on `routes/messages.tsx`.

**Tech Stack:** TypeScript strict, Express 4, Drizzle + Postgres, zod (`@ctp/shared`), React 19 + react-router, Vitest + RTL, supertest, Playwright + axe.

**Spec:** [`../specs/2026-09-30-ai-multi-chat-design.md`](../specs/2026-09-30-ai-multi-chat-design.md) — binding. The assistant as built: [`../specs/2026-09-23-ai-assistant-design.md`](../specs/2026-09-23-ai-assistant-design.md).

## Global Constraints

- `strict: true`, **no `any`** in committed code. `shared/` is the only place a domain shape is defined; both sides import it.
- A chat that is not the caller's, or does not exist, is **404 `CHAT_NOT_FOUND`** on every endpoint — never 403.
- Chat title: first message with whitespace collapsed, cut to **60** characters with a trailing `…` when longer. Rename: trimmed, **1–80** characters.
- Memory: at most the **40** most recent messages, passed through `budgetMessages` with a **6000**-character budget, as `MEMBER:` / `ASSISTANT:` lines under `CONVERSATION SO FAR:`. Message text only — never tool results or handles.
- `proposal_status` ∈ `open | applied | discarded`; `ai_run.kind` ∈ `chat | briefing | summary`.
- Reading, renaming and deleting chats, and discarding a plan, work with the assistant **off**. Sending a message and applying a plan require it on (`503 AI_DISABLED`).
- No test calls the model: the provider is stubbed (`geminiComplete` mocked in integration tests, `fetch` stubbed in frontend tests, `page.route` in e2e).
- shadcn/Radix first; hand-rolled interactive elements need keyboard handling and a label. Colours come from the theme variables; a dimmed row uses a background, never opacity (AA contrast).
- Commits are incremental, one concern each, no attribution lines.
- Integration tests use fixtures prefixed `test-ai-` and clean up only their own rows.

## Review Focus

1. **A second apply racing the first** (double click, two tabs): exactly one applies; the other gets `409 PROPOSAL_CLOSED` and writes nothing. → Task 5 test.
2. **A chat id that belongs to another member** on every chat route, including `POST /api/ai/messages` with `chatId`: 404, and the model is not called. → Tasks 3 and 4 tests.
3. **A first message that fails** (busy provider, or prose twice): no chat, no message, nothing in the list; the text comes back to the composer. → Task 4 (backend) and Task 8 (page) tests.
4. **A seeded event the member can no longer see**: it silently leaves the prompt; the chat keeps working. → Task 4 test.
5. **Deleting the chat that is open**, and opening a chat that no longer exists: the page returns to a blank New chat with a message. → Task 8 tests.

---

## File structure

```
shared/src/schemas/ai/ai.ts                 + chat, chat-message, rename, status schemas; message request/response change
shared/src/schemas/event/event.ts           + aiRunId on eventSummarySchema                         (Task 9)
backend/src/db/schema/channel.ts            + seed_event_id and its CHECK                            (Task 1)
backend/src/db/schema/ai-run.ts             channel_id optional/SET NULL; + kind, result, proposal_status (Task 1)
backend/drizzle/0011_*.sql                  generated, + hand-ordered data statements               (Task 1)
backend/src/db/seed-demo.ts                 remove the assistant channel                            (Task 1)
backend/src/routes/ai/service.ts            recordRun(kind, channelId, result, status); conversationBlock; briefing on run
backend/src/routes/ai/chats.ts              NEW — chat rules: title, find/require, list, create, rename, delete, history, messages
backend/src/routes/ai/chats.test.ts         NEW — unit tests for chatTitleFrom
backend/src/routes/ai/ai.ts                 chat routes; messages endpoint rewrite; discard route
backend/src/routes/ai/apply.ts              proposal_status claim
backend/src/routes/ai/tools/read.ts         export taskEventVisible
backend/src/routes/threads/service.ts       'ai' leaves the membership kinds                        (Task 6)
backend/src/routes/events/events.ts         EVENT_ROW_SELECT + aiRunId                              (Task 9)
frontend/src/hooks/use-ai-chats.ts          NEW — list, rename, remove, refresh
frontend/src/hooks/use-ai-chat.ts           NEW — one chat: messages, send, apply, discard
frontend/src/hooks/use-assistant.ts         DELETED (and its test)
frontend/src/hooks/use-briefing.ts          returns { state, retry }                                (Task 10)
frontend/src/components/ai/chat-list.tsx    NEW — left column
frontend/src/components/ai/chat-thread.tsx  NEW — right column: header, log, composer
frontend/src/components/ai/generated-panel.tsx  NEW                                                 (Task 9)
frontend/src/components/ai/briefing-panel.tsx   NEW — /ai/briefing                                  (Task 10)
frontend/src/components/ai/briefing-card.tsx    Overview card, four states                          (Task 10)
frontend/src/routes/ai-breakdown.tsx        container: two columns, routing between blank / chat / briefing
frontend/src/routes/messages.tsx            drop ai special cases
frontend/src/routes/dashboard.tsx           BriefingCard moves above the stat strip                 (Task 10)
frontend/src/main.tsx                       + /ai/:chatId, /ai/briefing
e2e/ai.spec.ts                              chat list + card; Messages shows no AI chat             (Task 11)
docs/api-endpoints.md, docs/prd.md          (Task 11)
```

---

## Task 1: Schema, shared schemas, migration `0011`

**Files:**

- Modify: `backend/src/db/schema/channel.ts`, `backend/src/db/schema/ai-run.ts`
- Create: `backend/drizzle/0011_<generated-name>.sql` (+ `meta/`)
- Modify: `backend/src/db/seed-demo.ts`, `backend/src/db/seed-demo.integration.test.ts`
- Modify: `shared/src/schemas/ai/ai.ts`, `shared/src/schemas/ai/ai.test.ts`
- Modify: `backend/src/db/constraints.integration.test.ts`

**Interfaces:**

- Produces (drizzle): `channels.seedEventId`; `aiRuns.kind` (`"chat" | "briefing" | "summary"`), `aiRuns.result` (`unknown | null`), `aiRuns.proposalStatus` (`"open" | "applied" | "discarded" | null`), `aiRuns.channelId` nullable.
- Produces (`@ctp/shared`): `aiRunKindSchema`, `aiProposalStatusSchema`, `aiChatSchema`/`AiChat`, `aiChatListResponseSchema`, `aiChatTitleSchema`, `aiRenameChatSchema`, `aiChatResponseSchema`, `aiAppliedSchema`/`AiApplied`, `aiChatMessageSchema`/`AiChatMessage`, `aiChatMessagesResponseSchema`, `aiChatParamsSchema`, `aiRunParamsSchema`; `aiMessageRequestSchema` gains `chatId` and the seed union; `aiMessageResponseSchema` gains `chatId`.

- [ ] **Step 1: Write the failing shared-schema tests**

Append to `shared/src/schemas/ai/ai.test.ts`:

```typescript
describe("chat schemas", () => {
  const uuid = "0192f1a0-0000-7000-8000-000000000001";

  it("accepts a message for an existing chat, a new chat, an event seed and a briefing seed", () => {
    for (const body of [
      { text: "hi" },
      { text: "hi", chatId: uuid },
      { text: "hi", seed: { eventId: uuid } },
      { text: "hi", seed: { briefing: true } },
    ]) {
      expect(aiMessageRequestSchema.safeParse(body).success).toBe(true);
    }
  });

  it("rejects a chat id that is not a uuid, and a seed that is neither kind", () => {
    expect(aiMessageRequestSchema.safeParse({ text: "hi", chatId: "T1" }).success).toBe(false);
    expect(
      aiMessageRequestSchema.safeParse({ text: "hi", seed: { briefing: false } }).success,
    ).toBe(false);
  });

  it("trims a rename and refuses blank or over-long titles", () => {
    expect(aiRenameChatSchema.parse({ title: "  Hack plan  " })).toEqual({ title: "Hack plan" });
    expect(aiRenameChatSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(aiRenameChatSchema.safeParse({ title: "x".repeat(81) }).success).toBe(false);
  });

  it("reads a chat message with its plan and status", () => {
    const parsed = aiChatMessageSchema.parse({
      id: uuid,
      role: "assistant",
      body: "Here is a plan.",
      createdAt: "2026-10-01T00:00:00.000Z",
      runId: uuid,
      proposal: {
        createTasks: [{ title: "Book", priority: "medium", dueAt: null, assignees: [] }],
      },
      proposalStatus: "open",
      applied: null,
    });
    expect(parsed.createdAt).toBeInstanceOf(Date);
    expect(parsed.proposalStatus).toBe("open");
  });
});
```

Add the new names to the file's import from `./ai.js`.

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run shared/src/schemas/ai/ai.test.ts`
Expected: FAIL — `aiRenameChatSchema` / `aiChatMessageSchema` are not exported.

- [ ] **Step 3: Add the shared schemas**

In `shared/src/schemas/ai/ai.ts`, replace `aiMessageRequestSchema` and `aiMessageResponseSchema` and append the chat block:

```typescript
/** POST /api/ai/messages. No `chatId` means "start a chat with this message". */
export const aiMessageRequestSchema = z.object({
  chatId: z.uuid().optional(),
  text: z.string().trim().min(1, "Say something").max(4000),
  /** Honoured only when the message starts a chat; an existing chat has its own. */
  seed: z
    .union([z.object({ eventId: z.uuid() }), z.object({ briefing: z.literal(true) })])
    .optional(),
});
export type AiMessageRequest = z.infer<typeof aiMessageRequestSchema>;

export const aiMessageResponseSchema = z.object({
  chatId: z.uuid(),
  runId: z.uuid(),
  reply: z.string(),
  proposal: aiResolvedProposalSchema.nullable(),
});
export type AiMessageResponse = z.infer<typeof aiMessageResponseSchema>;

// ── Chats ────────────────────────────────────────────────────────────────────

export const aiRunKindSchema = z.enum(["chat", "briefing", "summary"]);
export type AiRunKind = z.infer<typeof aiRunKindSchema>;

export const aiProposalStatusSchema = z.enum(["open", "applied", "discarded"]);
export type AiProposalStatus = z.infer<typeof aiProposalStatusSchema>;

export const aiChatParamsSchema = z.object({ id: z.uuid() });
export const aiRunParamsSchema = z.object({ runId: z.uuid() });

export const aiChatSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  seedEventId: z.uuid().nullable(),
  lastMessageAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});
export type AiChat = z.infer<typeof aiChatSchema>;

export const aiChatListResponseSchema = z.object({ chats: z.array(aiChatSchema) });
export const aiChatResponseSchema = z.object({ chat: aiChatSchema });

export const aiChatTitleSchema = z.string().trim().min(1, "Title is required").max(80);
export const aiRenameChatSchema = z.object({ title: aiChatTitleSchema });
export type AiRenameChat = z.infer<typeof aiRenameChatSchema>;

/** What an applied plan made, read back from `ai_run_id` provenance. */
export const aiAppliedSchema = z.object({
  events: z.array(z.object({ id: z.uuid(), title: z.string() })),
  tasks: z.array(z.object({ id: z.uuid(), title: z.string(), eventId: z.uuid().nullable() })),
});
export type AiApplied = z.infer<typeof aiAppliedSchema>;

export const aiChatMessageSchema = z.object({
  id: z.uuid(),
  role: z.enum(["member", "assistant"]),
  body: z.string(),
  createdAt: z.coerce.date(),
  /** Assistant replies only. */
  runId: z.uuid().nullable(),
  proposal: aiResolvedProposalSchema.nullable(),
  proposalStatus: aiProposalStatusSchema.nullable(),
  applied: aiAppliedSchema.nullable(),
});
export type AiChatMessage = z.infer<typeof aiChatMessageSchema>;

export const aiChatMessagesResponseSchema = z.object({
  chat: aiChatSchema,
  messages: z.array(aiChatMessageSchema),
});
export type AiChatMessagesResponse = z.infer<typeof aiChatMessagesResponseSchema>;
```

- [ ] **Step 4: Run the shared tests** — `npx vitest run shared/src/schemas/ai/ai.test.ts` → PASS.

- [ ] **Step 5: Write the failing constraint tests**

Append to `backend/src/db/constraints.integration.test.ts` (follow the file's existing helpers for inserting an `app_user`; clean up rows titled `test-ai-constraint-%`):

- "lets an ai_run exist with no channel" — insert `ai_run` with `channelId: null`, `kind: "briefing"`; expect it to be stored.
- "keeps a run when its chat is deleted, clearing the link" — insert an `ai` channel, a run pointing at it, delete the channel; the run still exists with `channel_id IS NULL`.
- "refuses a proposal status on a run that is not a chat" — insert `kind: "summary", proposalStatus: "open"` → rejects with `ai_run_proposal_status_only_on_chat_check`.
- "refuses a seed event on a channel that is not an ai chat" — insert `kind: "group", seedEventId: <event>` → rejects with `channel_seed_only_on_ai_check`.
- "clears a chat's seed when its event row is deleted" — ai channel with `seedEventId`, delete the event → channel remains, `seed_event_id IS NULL`.

Run: `npm run test:integration -- src/db/constraints.integration.test.ts` → FAIL (columns do not exist / TypeScript).

- [ ] **Step 6: Change the drizzle schema**

`backend/src/db/schema/channel.ts` — add the column and check, and add `table.seedEventId` to the `uuidShape(...)` call:

```typescript
    // The event an assistant chat was opened from (spec M9). Separate from
    // event_id, which means "this channel IS that event's thread": that one is
    // forbidden on an ai channel and cascades on delete.
    seedEventId: uuid("seed_event_id").references(() => events.id, { onDelete: "set null" }),
```

```typescript
    check(
      "channel_seed_only_on_ai_check",
      sql`${table.seedEventId} IS NULL OR ${table.kind} = 'ai'`,
    ),
```

Update the file's header comment: the assistant is "a dedicated PAGE" with **many** `ai` channels per member, one per chat.

`backend/src/db/schema/ai-run.ts`:

```typescript
    // Null for a briefing, and for a run whose chat was deleted: the run, its
    // evaluation counts and the ai_run_id on rows it made all outlive the chat.
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "set null" }),
```

```typescript
    kind: text("kind").$type<AiRunKind>().notNull().default("chat"),

    // chat run: the resolved proposal it drafted, if any. briefing run: the
    // briefing. Read back as-is, never queried into.
    result: jsonb("result"),

    // Only on a chat run that drafted a plan. What a reopened chat shows.
    proposalStatus: text("proposal_status").$type<AiProposalStatus>(),
```

```typescript
    check("ai_run_kind_check", sql`${table.kind} IN (${sqlEnumValues(aiRunKindSchema.options)})`),
    check(
      "ai_run_proposal_status_check",
      sql`${table.proposalStatus} IS NULL OR ${table.proposalStatus} IN (${sqlEnumValues(aiProposalStatusSchema.options)})`,
    ),
    check(
      "ai_run_proposal_status_only_on_chat_check",
      sql`${table.proposalStatus} IS NULL OR ${table.kind} = 'chat'`,
    ),
```

Import `aiRunKindSchema`, `aiProposalStatusSchema`, `type AiRunKind`, `type AiProposalStatus` from `@ctp/shared` and `sqlEnumValues` from `./sql-enum.js`.

- [ ] **Step 7: Generate the migration and add the data statements**

Run: `npm run db:generate` → `backend/drizzle/0011_<name>.sql`.

Open the generated file. Confirm it (a) drops `NOT NULL` on `ai_run.channel_id`, (b) replaces the `ai_run_channel_id_channel_id_fk` constraint with `ON DELETE set null`, (c) adds the columns and checks. Then append, after the last generated statement:

```sql
--> statement-breakpoint
UPDATE "ai_run" SET "kind" = 'briefing' WHERE "prompt" = 'Daily briefing';--> statement-breakpoint
UPDATE "ai_run" SET "kind" = 'summary' WHERE "prompt" LIKE 'Summarise thread %';--> statement-breakpoint
DELETE FROM "channel" WHERE "kind" = 'ai';
```

The `DELETE` must come after the foreign-key change, or the runs go with their channels.

- [ ] **Step 8: Remove the demo seed's assistant channel**

In `backend/src/db/seed-demo.ts`: delete the `channel("assistant")` row, its two `chan_member` rows and the `message("assistant-reply")` row (and any other message in that channel). Change the demo `ai_run` to `channelId: null, kind: "chat"`. In `seed-demo.integration.test.ts` lower the expected `channels`, `channelMembers` and `messages` counts by exactly the rows removed.

- [ ] **Step 9: Apply and run**

```bash
npm run db:migrate
npm run test:integration -- src/db
```

Expected: PASS, including `seed-demo.integration.test.ts` (which migrates a fresh database, proving `0011` applies from scratch). Then confirm the data steps locally:

```bash
docker exec ctp-postgres psql -U ctp -d ctp -Atc "select count(*) from channel where kind='ai'; select kind, count(*) from ai_run group by kind;"
```

Expected: `0` ai channels; runs grouped by kind, none lost.

- [ ] **Step 10: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run format:check && npm run test:unit
git add shared/src/schemas/ai backend/src/db backend/drizzle
git commit -m "feat(ai): let a member have many chats and a run stand without one"
```

---

## Task 2: Runs without a chat — `recordRun`, the briefing on its run, summary runs

**Files:**

- Modify: `backend/src/routes/ai/service.ts`, `backend/src/routes/ai/service.test.ts`
- Modify: `backend/src/routes/ai/ai.ts`, `backend/src/routes/ai/ai.integration.test.ts`

**Interfaces:**

- Produces:
  - `recordRun(tx: Tx, args: { userId: string; kind: AiRunKind; channelId: string | null; prompt: string; steps: RunStep[]; result?: unknown; proposalStatus?: AiProposalStatus | null; createdAt?: Date }): Promise<string>`
  - `findTodaysBriefing(db: Queryable, userId: string, dayKey: string): Promise<{ briefing: AiBriefing; generatedAt: Date; runId: string } | undefined>`
  - `briefingText(briefing: AiBriefing): string` — the summary, then one `- ` line per bullet.
- `resolveAiChannel` stays exported until Task 4 removes its last caller (the chat endpoint).

- [ ] **Step 1: Write the failing unit test** (append to `service.test.ts`, importing `briefingText`):

```typescript
describe("briefingText", () => {
  it("reads as the summary followed by one dash line per bullet", () => {
    expect(
      briefingText({ summary: "A quiet day.", bullets: ["Book the room", "Chase pizza"] }),
    ).toBe("A quiet day.\n- Book the room\n- Chase pizza");
  });

  it("is just the summary when there are no bullets", () => {
    expect(briefingText({ summary: "Nothing on.", bullets: [] })).toBe("Nothing on.");
  });
});
```

Run: `npx vitest run backend/src/routes/ai/service.test.ts` → FAIL — `briefingText` is not exported.

- [ ] **Step 2: Rewrite the briefing integration tests**

In `ai.integration.test.ts`, the `GET /api/ai/briefing` block: replace the "stores it once" assertion (one message in the ai channel) with:

```typescript
const runs = await db
  .select({ kind: aiRuns.kind, channelId: aiRuns.channelId, result: aiRuns.result })
  .from(aiRuns)
  .where(eq(aiRuns.userId, reader.id));
expect(runs).toEqual([{ kind: "briefing", channelId: null, result: JSON.parse(briefingJson) }]);
// A briefing is not a chat: it makes no channel and no message.
expect(await aiMessages(reader.id)).toEqual([]);
```

In the summary block's first test add: the run recorded is `{ kind: "summary", channelId: <the summarised channel id> }`.

Run the AI integration suite → these FAIL.

- [ ] **Step 3: Implement**

`service.ts`:

```typescript
export function briefingText(briefing: AiBriefing): string {
  return [briefing.summary, ...briefing.bullets.map((bullet) => `- ${bullet}`)].join("\n");
}

export async function recordRun(
  tx: Tx,
  args: {
    userId: string;
    kind: AiRunKind;
    channelId: string | null;
    prompt: string;
    steps: RunStep[];
    result?: unknown;
    proposalStatus?: AiProposalStatus | null;
    /** Set when the caller reports this instant to the client and it must read back identically. */
    createdAt?: Date;
  },
): Promise<string> {
  const id = newId();
  await tx.insert(aiRuns).values({
    id,
    kind: args.kind,
    channelId: args.channelId,
    userId: args.userId,
    prompt: args.prompt,
    steps: args.steps,
    result: args.result ?? null,
    proposalStatus: args.proposalStatus ?? null,
    costMicroUsd: 0,
    ...(args.createdAt ? { createdAt: args.createdAt } : {}),
  });
  return id;
}
```

`findTodaysBriefing` reads the run, not a message:

```typescript
const result = await db.execute<{ id: string; result: unknown; createdAt: Date }>(sql`
    SELECT r."id", r."result", r."created_at" AS "createdAt"
    FROM "ai_run" r
    WHERE r."user_id" = ${userId}
      AND r."kind" = 'briefing'
      AND r."result" IS NOT NULL
      AND to_char(r."created_at" AT TIME ZONE ${CLUB_TIMEZONE}, 'YYYY-MM-DD') = ${dayKey}
    ORDER BY r."created_at" DESC
    LIMIT 1
  `);
const row = result.rows[0];
if (!row) return undefined;
const parsed = aiBriefingSchema.safeParse(row.result);
return parsed.success
  ? { briefing: parsed.data, generatedAt: new Date(row.createdAt), runId: row.id }
  : undefined;
```

Delete `BRIEFING_RUN_PROMPT`'s role as a discriminator (keep the constant as the run's `prompt` text).

`ai.ts` — update the three callers:

- chat success and chat failure: `kind: "chat"`, `channelId: await resolveAiChannel(tx, me.id)` (unchanged behaviour until Task 4).
- summary: `kind: "summary"`, `channelId` = the summarised channel id.
- briefing: `kind: "briefing"`, `channelId: null`, `result: briefing`; **remove** the message insert and the `resolveAiChannel` call there; pass `createdAt: generatedAt` so the instant the first response reports is exactly what `findTodaysBriefing` reads back on the second (the existing "same `generatedAt`" test pins this).

- [ ] **Step 4: Run** — `npx vitest run backend/src/routes/ai && npm run test:integration -- src/routes/ai` → PASS.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run format:check
git add backend/src/routes/ai
git commit -m "refactor(ai): record what kind of run it was, and keep the briefing on its run"
```

---

## Task 3: Chat rules and the list, rename and delete endpoints

**Files:**

- Create: `backend/src/routes/ai/chats.ts`, `backend/src/routes/ai/chats.test.ts`
- Modify: `backend/src/routes/ai/ai.ts`, `backend/src/routes/ai/ai.integration.test.ts`

**Interfaces:**

- Produces (`chats.ts`, framework-free):
  - `AI_CHAT_TITLE_LENGTH = 60`
  - `chatTitleFrom(text: string): string`
  - `class ChatNotFoundError extends Error`
  - `type ChatRow = { id: string; title: string; seedEventId: string | null; createdAt: Date }`
  - `findChat(db: Queryable, userId: string, chatId: string): Promise<ChatRow | undefined>`
  - `requireChat(db: Queryable, userId: string, chatId: string): Promise<ChatRow>` — throws `ChatNotFoundError`
  - `listChats(db: Queryable, userId: string): Promise<AiChat[]>`
  - `createChat(tx: Tx, userId: string, args: { title: string; seedEventId: string | null }): Promise<string>`
  - `renameChat(db: Queryable, userId: string, chatId: string, title: string): Promise<AiChat>`
  - `deleteChat(db: Queryable, userId: string, chatId: string): Promise<void>`
- Produces (routes): `GET /api/ai/chats`, `PATCH /api/ai/chats/:id`, `DELETE /api/ai/chats/:id`.

- [ ] **Step 1: Write the failing unit test** — `backend/src/routes/ai/chats.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { chatTitleFrom } from "./chats.js";

describe("chatTitleFrom", () => {
  it("uses a short first message as it is", () => {
    expect(chatTitleFrom("Plan the hack night")).toBe("Plan the hack night");
  });

  it("collapses line breaks and runs of spaces, so a pasted paragraph is one line", () => {
    expect(chatTitleFrom("  Plan\n\nthe   hack\tnight ")).toBe("Plan the hack night");
  });

  it("cuts a long message to sixty characters, ending in an ellipsis", () => {
    const title = chatTitleFrom("a".repeat(200));
    expect(title).toHaveLength(60);
    expect(title.endsWith("…")).toBe(true);
  });

  it("leaves a message of exactly sixty characters uncut", () => {
    expect(chatTitleFrom("b".repeat(60))).toBe("b".repeat(60));
  });
});
```

Run: `npx vitest run backend/src/routes/ai/chats.test.ts` → FAIL — module not found.

- [ ] **Step 2: Write the failing integration tests**

Add a `describe("chats", …)` block to `ai.integration.test.ts` with a helper that inserts a chat directly:

```typescript
async function seedChat(owner: { id: string }, title: string, at = new Date()) {
  const id = newId();
  await db.insert(channels).values({ id, kind: "ai", name: title, createdAt: at });
  await db.insert(chanMembers).values({ channelId: id, userId: owner.id });
  return id;
}
```

Cases (each signs in, then asserts):

- "lists only the caller's chats, most recently active first" — two chats for the caller (one with a newer message), one for another member → two ids in activity order, the other member's absent.
- "renames a chat" → 200, `chat.title` is the trimmed title; the channel's `name` changed.
- "422s a blank or over-long title" → `VALIDATION_ERROR`, name unchanged.
- "404s another member's chat on rename and delete, and changes nothing" → `CHAT_NOT_FOUND`; the chat still exists with its name.
- "deletes a chat and its messages but keeps its runs and what they made" — chat with a message, a chat run pointing at it and a task with that `ai_run_id` → 204; channel and message gone; the run exists with `channelId: null`; the task still has its `aiRunId`.
- "lists, renames and deletes with the assistant switched off" — `vi.stubEnv("AI_ENABLED", "")` → 200 / 200 / 204.

Extend the file's `cleanup()` so it deletes every `ai` channel belonging to `test-ai-%` users (it already does by membership).

Run the AI integration suite → FAIL (404 on the missing routes).

- [ ] **Step 3: Write `chats.ts`**

```typescript
import type { AiChat } from "@ctp/shared";
import { and, eq, sql } from "drizzle-orm";
import { newId } from "../../db/id.js";
import { chanMembers, channels } from "../../db/schema/index.js";
import type { Queryable, Tx } from "../events/service.js";

export const AI_CHAT_TITLE_LENGTH = 60;

/** A chat is named by what the member first asked: one line, cut to fit the list. */
export function chatTitleFrom(text: string): string {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length <= AI_CHAT_TITLE_LENGTH
    ? line
    : `${line.slice(0, AI_CHAT_TITLE_LENGTH - 1).trimEnd()}…`;
}

/** 404 — not the caller's chat, or no such chat. The two are deliberately indistinguishable. */
export class ChatNotFoundError extends Error {
  constructor(message = "Chat not found.") {
    super(message);
    this.name = "ChatNotFoundError";
  }
}

export type ChatRow = { id: string; title: string; seedEventId: string | null; createdAt: Date };

/** The one ownership rule: an `ai` channel the caller is a member of. */
const ownedBy = (userId: string, chatId: string) =>
  and(eq(channels.id, chatId), eq(channels.kind, "ai"), eq(chanMembers.userId, userId));

export async function findChat(
  db: Queryable,
  userId: string,
  chatId: string,
): Promise<ChatRow | undefined> {
  const [row] = await db
    .select({
      id: channels.id,
      title: channels.name,
      seedEventId: channels.seedEventId,
      createdAt: channels.createdAt,
    })
    .from(channels)
    .innerJoin(chanMembers, eq(chanMembers.channelId, channels.id))
    .where(ownedBy(userId, chatId))
    .limit(1);
  return row ? { ...row, title: row.title ?? "" } : undefined;
}

export async function requireChat(db: Queryable, userId: string, chatId: string): Promise<ChatRow> {
  const chat = await findChat(db, userId, chatId);
  if (!chat) throw new ChatNotFoundError();
  return chat;
}

/** Most recently active first; a chat with no message yet sorts by when it was made. */
export async function listChats(db: Queryable, userId: string): Promise<AiChat[]> {
  const result = await db.execute<{
    id: string;
    title: string;
    seedEventId: string | null;
    lastMessageAt: Date;
    createdAt: Date;
  }>(sql`
    SELECT c."id", c."name" AS "title", c."seed_event_id" AS "seedEventId",
           COALESCE(MAX(m."created_at"), c."created_at") AS "lastMessageAt",
           c."created_at" AS "createdAt"
    FROM "channel" c
    JOIN "chan_member" cm ON cm."channel_id" = c."id" AND cm."user_id" = ${userId}
    LEFT JOIN "message" m ON m."channel_id" = c."id"
    WHERE c."kind" = 'ai'
    GROUP BY c."id"
    ORDER BY "lastMessageAt" DESC, c."id" DESC
  `);
  return result.rows.map((row) => ({
    ...row,
    lastMessageAt: new Date(row.lastMessageAt),
    createdAt: new Date(row.createdAt),
  }));
}

export async function createChat(
  tx: Tx,
  userId: string,
  args: { title: string; seedEventId: string | null },
): Promise<string> {
  const id = newId();
  await tx
    .insert(channels)
    .values({ id, kind: "ai", name: args.title, seedEventId: args.seedEventId });
  await tx.insert(chanMembers).values({ channelId: id, userId });
  return id;
}

export async function renameChat(
  db: Queryable,
  userId: string,
  chatId: string,
  title: string,
): Promise<AiChat> {
  await requireChat(db, userId, chatId);
  await db.update(channels).set({ name: title }).where(eq(channels.id, chatId));
  const chat = (await listChats(db, userId)).find((row) => row.id === chatId);
  if (!chat) throw new ChatNotFoundError();
  return chat;
}

/** Messages and the membership go by cascade; runs stay, their chat link cleared (spec M6). */
export async function deleteChat(db: Queryable, userId: string, chatId: string): Promise<void> {
  await requireChat(db, userId, chatId);
  await db.delete(channels).where(eq(channels.id, chatId));
}
```

- [ ] **Step 4: Add the routes to `ai.ts`**

`ChatNotFoundError` → `404 { code: "CHAT_NOT_FOUND" }` in `sendAiError`. None of the three checks `aiConfig().enabled`.

```typescript
aiRouter.get("/ai/chats", authenticate, authorise(0), async (req, res, next) => {
  try {
    const chats = await listChats(getDb(), req.user!.id);
    res.status(200).json(aiChatListResponseSchema.parse({ chats }));
  } catch (error) {
    if (!sendAiError(res, error)) next(error);
  }
});

aiRouter.patch(
  "/ai/chats/:id",
  authenticate,
  authorise(0),
  validate(aiChatParamsSchema, "params"),
  validate(aiRenameChatSchema),
  async (req, res, next) => {
    try {
      const { title } = res.locals.validated as AiRenameChat;
      const chat = await renameChat(getDb(), req.user!.id, req.params.id!, title);
      res.status(200).json(aiChatResponseSchema.parse({ chat }));
    } catch (error) {
      if (!sendAiError(res, error)) next(error);
    }
  },
);

aiRouter.delete(
  "/ai/chats/:id",
  authenticate,
  authorise(0),
  validate(aiChatParamsSchema, "params"),
  async (req, res, next) => {
    try {
      await deleteChat(getDb(), req.user!.id, req.params.id!);
      res.status(204).end();
    } catch (error) {
      if (!sendAiError(res, error)) next(error);
    }
  },
);
```

Note: `validate(schema, "params")` followed by `validate(bodySchema)` — `res.locals.validated` holds the **last** validated part (the body), which is what the handler reads; the id comes from `req.params`.

- [ ] **Step 5: Run** — `npx vitest run backend/src/routes/ai && npm run test:integration -- src/routes/ai` → PASS.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run format:check
git add backend/src/routes/ai
git commit -m "feat(ai): list, rename and delete assistant chats"
```

---

## Task 4: Messages in a chat — lazy creation, memory, the chat's event, saved plans

**Files:**

- Modify: `backend/src/routes/ai/service.ts`, `backend/src/routes/ai/service.test.ts`
- Modify: `backend/src/routes/ai/chats.ts`
- Modify: `backend/src/routes/ai/tools/read.ts` (export `taskEventVisible`)
- Modify: `backend/src/routes/ai/ai.ts`, `backend/src/routes/ai/ai.integration.test.ts`

**Interfaces:**

- Consumes: Task 1 schemas; Task 2 `recordRun`, `findTodaysBriefing`, `briefingText`; Task 3 `requireChat`, `createChat`, `chatTitleFrom`.
- Produces:
  - `CHAT_HISTORY_MESSAGES = 40`, `CHAT_HISTORY_CHAR_BUDGET = 6000` (`service.ts`)
  - `conversationBlock(history: PromptMessage[], maxChars: number): string` (`service.ts`) — `""` when there is no history; otherwise `CONVERSATION SO FAR:` and one `AUTHOR: body` line per kept message, where `author` is `"MEMBER"` or `"ASSISTANT"`.
  - `chatHistory(db: Queryable, chatId: string, limit: number): Promise<PromptMessage[]>` (`chats.ts`) — oldest first.
  - `chatMessages(db: Queryable, viewer: { id: string; tier: Tier }, chat: ChatRow): Promise<AiChatMessage[]>` (`chats.ts`)
  - `GET /api/ai/chats/:id/messages`; `POST /api/ai/messages` per spec §4.2.
- Removes: `resolveAiChannel`.

- [ ] **Step 1: Write the failing unit tests** (append to `service.test.ts`):

```typescript
describe("conversationBlock", () => {
  const said = (author: string, body: string, id = body) => ({
    id,
    author,
    body,
    createdAt: new Date(0),
  });

  it("is empty for a chat with no history, so a first message adds nothing to the prompt", () => {
    expect(conversationBlock([], 1000)).toBe("");
  });

  it("labels each line by who said it, oldest first", () => {
    expect(
      conversationBlock([said("MEMBER", "Plan it"), said("ASSISTANT", "Here is a plan.")], 1000),
    ).toBe("CONVERSATION SO FAR:\nMEMBER: Plan it\nASSISTANT: Here is a plan.");
  });

  it("drops the oldest messages once the budget is spent", () => {
    const block = conversationBlock(
      [said("MEMBER", "a".repeat(60)), said("ASSISTANT", "b".repeat(60)), said("MEMBER", "latest")],
      80,
    );
    expect(block).not.toContain("a".repeat(60));
    expect(block).toContain("latest");
  });
});
```

Run → FAIL — `conversationBlock` is not exported.

- [ ] **Step 2: Implement `conversationBlock`**

```typescript
export const CHAT_HISTORY_MESSAGES = 40;
export const CHAT_HISTORY_CHAR_BUDGET = 6000;

/**
 * What a chat remembers (spec M2, M3): the words of its recent messages and
 * nothing else. No tool results and no handles cross from one turn to the
 * next — the model re-reads through its tools, under today's permissions.
 */
export function conversationBlock(history: PromptMessage[], maxChars: number): string {
  const kept = budgetMessages(history, maxChars);
  if (kept.length === 0) return "";
  return [
    "CONVERSATION SO FAR:",
    ...kept.map((message) => `${message.author}: ${message.body}`),
  ].join("\n");
}
```

Run → PASS.

- [ ] **Step 3: Write the failing integration tests**

In `ai.integration.test.ts`, add to `describe("POST /api/ai/messages")` (the existing tests stay: a message with no `chatId` still answers, now also returning `chatId`):

- "starts a chat with the first message, titled from it" — `text: "  Plan the\nhack night  "` → `response.body.chatId` is a uuid; `GET /api/ai/chats` lists one chat titled `"Plan the hack night"`.
- "creates nothing when the first turn fails" — prose twice → 422; `GET /api/ai/chats` → `[]`; no `message` rows for the caller. Repeat with `complete.mockRejectedValue(new AiUnavailableError())` → 503, still `[]`.
- "remembers the chat: the second turn is shown the first exchange, in words only" — first turn scripted as `callTool("listTasks")`, `reply("Two tasks are open.")`; second turn `{ chatId, text: "Which is urgent?" }` with `reply("The poster.")`. Assert the second request's first prompt contains `CONVERSATION SO FAR:`, `MEMBER: What is open?`, `ASSISTANT: Two tasks are open.`, and does **not** contain `TOOL RESULT`.
- "404s a chat that belongs to someone else, before the model is called" → `CHAT_NOT_FOUND`, `complete` not called.
- "keeps a chat's event in view across turns" — tier-0 caller, visible event `test-ai-seeded`; first message `seed: { eventId }`; assert the chat's `seedEventId`, and that the **second** turn's prompt contains `test-ai-seeded`.
- "drops a chat's event from view once the member can no longer see it" — same chat, then `UPDATE event SET min_tier = 2`; third turn's prompt does not contain the title, and the turn still answers 200.
- "ignores a seed event the member cannot see" — `seed: { eventId: <tier-2 event> }` as tier 0 → the created chat has `seedEventId: null`.
- "starts a chat from the briefing, opening with it" — insert an `ai_run` `{ kind: "briefing", result: { summary: "A quiet day.", bullets: ["Book the room"] } }` for the caller; `POST { text: "What first?", seed: { briefing: true } }`; assert the prompt contains `ASSISTANT: A quiet day.`, and `GET …/messages` returns three messages: assistant `"A quiet day.\n- Book the room"`, member, assistant reply.
- "starts normally when there is no briefing to seed from" → 200, two messages.

Add `describe("GET /api/ai/chats/:id/messages")`:

- "returns the conversation oldest first, with a drafted plan open under its reply" — planning turn (`proposeCreateTasks`) → the last message has `role: "assistant"`, `runId`, `proposalStatus: "open"`, `proposal.createTasks[0].title`, `applied: null`; the member's message has `runId: null`, `proposal: null`.
- "404s another member's chat" → `CHAT_NOT_FOUND`.
- "reads a chat with the assistant switched off" → 200.

Update the existing "keeps the member's message and the stamped reply in their ai channel" test to read through `GET …/messages` for `response.body.chatId`.

Run → FAIL.

- [ ] **Step 4: Add `chatHistory` and `chatMessages` to `chats.ts`**

```typescript
/** The chat's most recent messages, oldest first, labelled for the prompt. */
export async function chatHistory(
  db: Queryable,
  chatId: string,
  limit: number,
): Promise<PromptMessage[]> {
  const rows = await db
    .select({
      id: messages.id,
      author: messages.author,
      body: messages.body,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.channelId, chatId))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit);
  return rows.reverse().map((row) => ({ ...row, author: row.author ? "MEMBER" : "ASSISTANT" }));
}
```

`chatMessages` selects the chat's messages oldest first, left-joining `ai_run` on `message.ai_run_id`. For each row: `role` from `author`; `runId` = `ai_run_id`; `proposal` and `proposalStatus` only when the joined run's `kind = 'chat'` and `proposal_status IS NOT NULL` (parse `result` with `aiResolvedProposalSchema.safeParse`, `null` on failure); `applied` only when the status is `applied`:

```typescript
async function appliedBy(db: Queryable, tier: Tier, runId: string): Promise<AiApplied> {
  const [madeEvents, madeTasks] = await Promise.all([
    db
      .select({ id: events.id, title: events.title })
      .from(events)
      .where(and(eq(events.aiRunId, runId), visibleEvents(tier))),
    db
      .select({ id: tasks.id, title: tasks.title, eventId: tasks.eventId })
      .from(tasks)
      .where(and(eq(tasks.aiRunId, runId), taskEventVisible(tier))),
  ]);
  return { events: madeEvents, tasks: madeTasks };
}
```

Export `taskEventVisible` from `tools/read.ts` (it is already the one task-visibility rule).

- [ ] **Step 5: Rewrite the messages handler in `ai.ts`**

Order, inside the existing `try`:

```typescript
const chat = body.chatId ? await requireChat(db, me.id, body.chatId) : undefined;
await assertUnderDailyCap(db, me.id, config.dailyRunCap);

// A new chat takes its event from the seed; an existing one keeps its own.
const wantedEventId = chat
  ? chat.seedEventId
  : body.seed && "eventId" in body.seed
    ? body.seed.eventId
    : null;
const seeded = await seedContext(db, ctx.handles, me.tier, wantedEventId);

// A chat started from the briefing opens with it (spec M14).
const briefing =
  !chat && body.seed && "briefing" in body.seed
    ? await findTodaysBriefing(db, me.id, clubDayKey(receivedAt, CLUB_TIMEZONE))
    : undefined;
const history: PromptMessage[] = chat
  ? await chatHistory(db, chat.id, CHAT_HISTORY_MESSAGES)
  : briefing
    ? [
        {
          id: briefing.runId,
          author: "ASSISTANT",
          body: briefingText(briefing.briefing),
          createdAt: briefing.generatedAt,
        },
      ]
    : [];

let transcript = [
  buildSystemPrompt(toolsFor(me.tier), seeded.context),
  conversationBlock(history, CHAT_HISTORY_CHAR_BUDGET),
  `MEMBER: ${body.text}`,
]
  .filter(Boolean)
  .join("\n\n");
```

`seedContext` changes signature to take the event id and return `{ context: string; eventId: string | null }` — `eventId` is non-null only when the caller can see the event, and that is what a new chat stores.

The loop and resolution are unchanged. The success transaction becomes:

```typescript
const { chatId, runId } = await db.transaction(async (tx) => {
  const chatId =
    chat?.id ??
    (await createChat(tx, me.id, { title: chatTitleFrom(body.text), seedEventId: seeded.eventId }));
  if (!chat && briefing) {
    await tx.insert(messages).values({
      id: newId(),
      channelId: chatId,
      author: null,
      body: briefingText(briefing.briefing),
      aiRunId: briefing.runId,
      // Just before the member's message, so it reads first.
      createdAt: new Date(receivedAt.getTime() - 1),
    });
  }
  const runId = await recordRun(tx, {
    userId: me.id,
    kind: "chat",
    channelId: chatId,
    prompt: body.text,
    steps,
    result: proposal,
    proposalStatus: proposal ? "open" : null,
  });
  await tx.insert(messages).values([
    { id: newId(), channelId: chatId, author: me.id, body: body.text, createdAt: receivedAt },
    {
      id: newId(),
      channelId: chatId,
      author: null,
      body: replyText,
      aiRunId: runId,
      createdAt: new Date(),
    },
  ]);
  return { chatId, runId };
});

res.status(200).json(aiMessageResponseSchema.parse({ chatId, runId, reply: replyText, proposal }));
```

The failed-turn `recordRun` uses `kind: "chat", channelId: chat?.id ?? null`.

Add the read route:

```typescript
aiRouter.get(
  "/ai/chats/:id/messages",
  authenticate,
  authorise(0),
  validate(aiChatParamsSchema, "params"),
  async (req, res, next) => {
    try {
      const me = req.user!;
      const db = getDb();
      const chat = await requireChat(db, me.id, req.params.id!);
      const [summary] = (await listChats(db, me.id)).filter((row) => row.id === chat.id);
      const messages = await chatMessages(db, { id: me.id, tier: me.tier }, chat);
      res.status(200).json(aiChatMessagesResponseSchema.parse({ chat: summary, messages }));
    } catch (error) {
      if (!sendAiError(res, error)) next(error);
    }
  },
);
```

Delete `resolveAiChannel` from `service.ts` and its import.

- [ ] **Step 6: Run** — `npx vitest run backend/src/routes/ai && npm run test:integration -- src/routes/ai` → PASS.

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run format:check && npm run test:unit
git add backend/src/routes/ai
git commit -m "feat(ai): hold a conversation in a chat that remembers itself"
```

---

## Task 5: Apply and discard with a plan status

**Files:**

- Modify: `backend/src/routes/ai/apply.ts`, `backend/src/routes/ai/ai.ts`, `backend/src/routes/ai/ai.integration.test.ts`

**Interfaces:**

- Consumes: `aiRuns.proposalStatus`, `aiRuns.kind`.
- Produces: `applyProposal` refuses a run whose plan is not `open` (`ApplyError(409, "PROPOSAL_CLOSED", …)`) and marks it `applied`; `discardProposal(db: Queryable, userId: string, runId: string): Promise<void>`; `POST /api/ai/proposals/:runId/discard` → 204.

- [ ] **Step 1: Make the apply tests draft a real plan**

`runFor` currently sends a plain reply, which leaves no plan to apply. Change it to draft one:

```typescript
async function runFor(actor: { authUserId: string }): Promise<string> {
  signedInAs(actor);
  script(callTool("proposeCreateTasks", { tasks: [{ title: "test-ai-drafted" }] }), reply());
  const response = await request(app).post("/api/ai/messages").send({ text: "Plan it" });
  prompts = [];
  return response.body.runId as string;
}
```

- [ ] **Step 2: Write the failing tests** (append to the apply block):

- "marks the plan applied, and the chat then shows what it made" — apply one task; `GET …/messages` for the chat → the reply has `proposalStatus: "applied"` and `applied.tasks` containing the new task's id and title.
- "refuses a second apply of the same plan and writes nothing more" — apply twice with different task titles → `201`, then `409 PROPOSAL_CLOSED`; the second title has no row.
- "lets only one of two simultaneous applies through" — `Promise.all` of two apply requests for the same run → statuses sorted are `[201, 409]`; exactly one task row.
- "refuses to apply a run that drafted no plan" — a run from a plain reply → `409 PROPOSAL_CLOSED`.

Add `describe("POST /api/ai/proposals/:runId/discard")`:

- "discards an open plan, which then reads as discarded" → 204; `GET …/messages` shows `proposalStatus: "discarded"`, `applied: null`.
- "409s discarding a plan that is already applied or discarded" → `PROPOSAL_CLOSED`.
- "404s someone else's run" → `RUN_NOT_FOUND`, status unchanged.
- "refuses to apply a discarded plan" → `409 PROPOSAL_CLOSED`.
- "discards with the assistant switched off" → 204.

Run → FAIL.

- [ ] **Step 3: Implement the claim in `apply.ts`**

Replace the run lookup at the top of `applyProposal`. The claim is one conditional `UPDATE`, first in the transaction, so a concurrent apply blocks on the row and then finds it no longer `open`:

```typescript
// Claim the plan before doing any work. The row lock this takes is what
// makes two applies of one plan impossible: the second waits, then sees
// `applied` and is refused with nothing written.
const [claimed] = await tx
  .update(aiRuns)
  .set({ proposalStatus: "applied" })
  .where(
    and(
      eq(aiRuns.id, request.runId),
      eq(aiRuns.userId, caller.id),
      eq(aiRuns.kind, "chat"),
      eq(aiRuns.proposalStatus, "open"),
    ),
  )
  .returning({ id: aiRuns.id });
if (!claimed) {
  const [run] = await tx
    .select({ id: aiRuns.id })
    .from(aiRuns)
    .where(and(eq(aiRuns.id, request.runId), eq(aiRuns.userId, caller.id)));
  if (!run) throw new ApplyError(404, "RUN_NOT_FOUND", "That assistant run is not yours to apply.");
  throw new ApplyError(409, "PROPOSAL_CLOSED", "This plan has already been applied or discarded.");
}
```

Any later refusal throws and rolls the claim back with everything else.

```typescript
export async function discardProposal(db: Queryable, userId: string, runId: string): Promise<void> {
  const [discarded] = await db
    .update(aiRuns)
    .set({ proposalStatus: "discarded" })
    .where(
      and(
        eq(aiRuns.id, runId),
        eq(aiRuns.userId, userId),
        eq(aiRuns.kind, "chat"),
        eq(aiRuns.proposalStatus, "open"),
      ),
    )
    .returning({ id: aiRuns.id });
  if (discarded) return;
  const [run] = await db
    .select({ id: aiRuns.id })
    .from(aiRuns)
    .where(and(eq(aiRuns.id, runId), eq(aiRuns.userId, userId)));
  if (!run) throw new ApplyError(404, "RUN_NOT_FOUND", "That assistant run is not yours.");
  throw new ApplyError(409, "PROPOSAL_CLOSED", "This plan has already been applied or discarded.");
}
```

Route (no `enabled` check):

```typescript
aiRouter.post(
  "/ai/proposals/:runId/discard",
  authenticate,
  authorise(0),
  validate(aiRunParamsSchema, "params"),
  async (req, res, next) => {
    try {
      await discardProposal(getDb(), req.user!.id, req.params.runId!);
      res.status(204).end();
    } catch (error) {
      if (!sendAiError(res, error)) next(error);
    }
  },
);
```

- [ ] **Step 4: Run** — `npm run test:integration -- src/routes/ai` → PASS.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run format:check
git add backend/src/routes/ai
git commit -m "feat(ai): keep a drafted plan with its chat until it is applied or discarded"
```

---

## Task 6: The threads API stops serving AI chats

**Files:**

- Modify: `backend/src/routes/threads/service.ts`, `backend/src/routes/threads/threads.integration.test.ts`

**Interfaces:**

- Produces: `visibleThreads`, `findThread`, `listThreads`, `assertCanReadChannel` and the mention audience no longer match a channel of kind `ai`.

- [ ] **Step 1: Write the failing test** (append to the threads integration suite, using its own member/session helpers):

```typescript
describe("assistant chats", () => {
  it("never lists an ai chat, and 404s reading, posting to or marking one read", async () => {
    const owner = await member("chat-owner", "officer");
    const chatId = newId();
    await db.insert(channels).values({ id: chatId, kind: "ai", name: "test-thread-ai-chat" });
    await db.insert(chanMembers).values({ channelId: chatId, userId: owner.id });
    signedInAs(owner);

    const list = await request(app).get("/api/threads");
    expect(list.body.threads.map((thread: { id: string }) => thread.id)).not.toContain(chatId);

    expect((await request(app).get(`/api/threads/${chatId}/messages`)).status).toBe(404);
    expect(
      (await request(app).post(`/api/threads/${chatId}/messages`).send({ body: "hello" })).status,
    ).toBe(404);
    expect((await request(app).post(`/api/threads/${chatId}/read`)).status).toBe(404);
  });
});
```

(Adapt the helper names and the mark-read route to the file's own; read it first. Make sure its cleanup removes the `test-thread-ai-chat` channel.)

Run: `npm run test:integration -- src/routes/threads` → FAIL (the chat is listed / readable).

- [ ] **Step 2: Implement**

In `routes/threads/service.ts` change both declarations and the comment above them:

```typescript
// `ai` is deliberately absent: an assistant chat is a channel too, but it is
// served only by routes/ai (its own ownership check), never as a thread.
const MEMBERSHIP_KINDS = ["group", "dm"] as const;
```

```typescript
const MEMBERSHIP_KINDS_SET = new Set<ChannelKind>(["group", "dm"]);
```

- [ ] **Step 3: Run** — `npm run test:integration -- src/routes` → PASS (threads, ai, tasks comments).

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/threads
git commit -m "fix(threads): never serve an assistant chat as a thread"
```

---

## Task 7: Frontend hooks — `useAiChats` and `useAiChat`

**Files:**

- Create: `frontend/src/hooks/use-ai-chats.ts`, `frontend/src/hooks/use-ai-chats.test.ts`
- Create: `frontend/src/hooks/use-ai-chat.ts`, `frontend/src/hooks/use-ai-chat.test.ts`

**Interfaces:**

- Consumes: Task 1 shared schemas; `readAiError` from `@/lib/ai-errors`.
- Produces:

```typescript
// use-ai-chats.ts
type ChatsState =
  { status: "loading" } | { status: "ok"; items: AiChat[] } | { status: "error"; message: string };
export function useAiChats(): {
  state: ChatsState;
  refresh: () => Promise<void>;
  rename: (chat: AiChat, title: string) => Promise<boolean>;
  remove: (chat: AiChat) => Promise<boolean>;
  mutationError: string | undefined;
};

// use-ai-chat.ts
export type ChatSeed = { eventId: string } | { briefing: true };
type ChatState =
  | { status: "blank" } // no chat yet: /ai
  | { status: "loading" }
  | { status: "ok"; chat: AiChat | undefined; messages: AiChatMessage[] }
  | { status: "missing" } // 404 CHAT_NOT_FOUND
  | { status: "error"; message: string };
export function useAiChat(
  chatId: string | undefined,
  options?: { seed?: ChatSeed; onChatCreated?: (chatId: string) => void; onChanged?: () => void },
): {
  state: ChatState;
  /** Resolves false when the turn failed; the caller restores the draft. */
  send: (text: string) => Promise<boolean>;
  apply: (runId: string, operations: AiApplyOperation[], stats: ApplyStats) => Promise<boolean>;
  discard: (runId: string) => Promise<boolean>;
  pending: boolean;
  /** True while a reply (not an apply) is awaited: drives the thinking indicator. */
  thinking: boolean;
  error: string | undefined;
  disabled: boolean; // AI_DISABLED seen: composer off, chats still readable
};
```

- [ ] **Step 1: Write the failing `useAiChats` tests** (`renderHook`, `fetch` stubbed per URL/method as in `use-assistant.test.tsx`):

- "loads the member's chats" → `state.status === "ok"`, items parsed (`lastMessageAt` a `Date`).
- "renames a chat in place" → `PATCH /api/ai/chats/:id` with `{ title }`; the item's title updates; resolves `true`.
- "removes a chat from the list" → `DELETE /api/ai/chats/:id`; item gone; resolves `true`.
- "keeps the list and reports the error when a rename is refused" → 422 → resolves `false`, `mutationError` set, title unchanged.
- "reloads on refresh" → a second `GET`.

- [ ] **Step 2: Write the failing `useAiChat` tests**

- "is blank with no chat id, and fetches nothing" → `state.status === "blank"`, `fetch` not called.
- "loads a chat's messages" → `GET /api/ai/chats/:id/messages`; `ok` with messages.
- "reports a chat that no longer exists as missing" → 404 `CHAT_NOT_FOUND` → `missing`.
- "shows the member's message at once, then the reply, and reports the new chat" — deferred `fetch`: after `send`, `messages` ends with the member's text and `thinking` is true; resolve with `{ chatId, runId, reply, proposal: null }` → messages end with the reply, `thinking` false, `onChatCreated` called with `chatId`, `send` resolved `true`; request body is `{ text, seed }` with no `chatId`.
- "sends into an existing chat by id, without the seed" → body `{ chatId, text }`.
- "does not refetch the chat it just created" — after `onChatCreated`, rerender with the new id → no `GET …/messages` call.
- "takes a failed turn back out and says why" — 503 `AI_UNAVAILABLE` → resolves `false`, the optimistic message is gone, `error` is the server's message, `disabled` false.
- "turns the composer off when the assistant is disabled" — 503 `AI_DISABLED` → `disabled` true, `error` undefined.
- "puts a drafted plan on its reply" → the reply message has `proposal`, `proposalStatus: "open"`, `runId`.
- "applies a plan, then reloads the chat to show what it made" → `POST /api/ai/proposals/apply` body `{ runId, operations, stats }`, then a `GET …/messages`; resolves `true`; `onChanged` called.
- "reloads and reports when a plan was already closed" → 409 → resolves `false`, `error` set, a `GET …/messages` follows.
- "discards a plan, then reloads" → `POST /api/ai/proposals/:runId/discard`.

Run both → FAIL (modules not found).

- [ ] **Step 3: Write the hooks**

Follow `use-tasks.ts`: discriminated-union state, `useCallback` actions, every response parsed with the shared schema before it reaches state. Implementation notes that the tests above pin:

- `useAiChat` keeps a `loadedFor` ref. The fetch effect runs on `chatId` change and **skips** when `chatId === loadedFor.current` (the chat this hook just created and already holds).
- `send` appends an optimistic `AiChatMessage` (`id: "pending-<n>"`, `role: "member"`, `runId: null`, `proposal: null`, `proposalStatus: null`, `applied: null`) to the current messages (a `blank` state becomes `ok` with `chat: undefined`). On failure it removes that message (returning to `blank` if it was the only one) and returns `false`.
- On success it appends the reply message built from the response (`proposalStatus: proposal ? "open" : null`), sets `loadedFor.current = chatId`, and — only if there was no `chatId` — calls `onChatCreated(chatId)`. It always calls `onChanged()` (the list's order and titles changed).
- `seed` is sent only when there is no `chatId`.
- `apply`/`discard` reload the chat afterwards in every outcome except a network failure.

- [ ] **Step 4: Run** — `npx vitest run frontend/src/hooks/use-ai-chats.test.ts frontend/src/hooks/use-ai-chat.test.ts` → PASS.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run format:check
git add frontend/src/hooks/use-ai-chats.ts frontend/src/hooks/use-ai-chats.test.ts frontend/src/hooks/use-ai-chat.ts frontend/src/hooks/use-ai-chat.test.ts
git commit -m "feat(ai): add the chat list and chat view-models"
```

---

## Task 8: The two-column chat page

**Files:**

- Create: `frontend/src/components/ai/chat-list.tsx`, `frontend/src/components/ai/chat-thread.tsx`
- Modify: `frontend/src/routes/ai-breakdown.tsx`, `frontend/src/routes/ai-breakdown.test.tsx`
- Modify: `frontend/src/main.tsx` (add `/ai/:chatId`)
- Modify: `frontend/src/routes/messages.tsx`, `frontend/src/routes/messages.test.tsx`
- Delete: `frontend/src/hooks/use-assistant.ts`, `frontend/src/hooks/use-assistant.test.tsx`

**Interfaces:**

- Consumes: Task 7 hooks; `ProposalCard` (`onApply(operations, stats)`, `onDiscard()`, `busy`); `Dialog` from `@/components/ui/dialog`.
- Produces:
  - `<ChatList chats activeId onRename onRemove busy />` — links, not buttons, for navigation (`/ai`, `/ai/:id`).
  - `<ChatThread title seedEventId messages thinking pending error disabled members onSend onApply onDiscard headerActions />` — `onSend(text): Promise<boolean>`.
  - `AiBreakdownPage` reads `chatId` from `useParams` and `eventId` from `useSearchParams`.

- [ ] **Step 1: Rewrite the page tests first**

Replace `ai-breakdown.test.tsx`. Render inside a `createMemoryRouter` with routes `/ai` and `/ai/:chatId` both rendering `<AiBreakdownPage />` so navigation is observable (`router.state.location.pathname`). A `stubApi` helper answers, by URL and method: `GET /api/ai/chats`, `GET /api/ai/chats/:id/messages`, `POST /api/ai/messages`, `PATCH`/`DELETE /api/ai/chats/:id`, `POST /api/ai/proposals/apply`, `POST /api/ai/proposals/:id/discard`, `GET /api/members`, and throws on anything else.

Cases:

- "lists the member's chats beside a blank New chat" — two chats → both titles are links; a "New chat" link; the composer textbox; no "Generated tasks" heading.
- "opens a chat from the list" — click a title → pathname `/ai/<id>`; its messages render; its row has `aria-current="page"`.
- "starts a chat with the first message and moves to it" — type, Send → the member's text shows at once with the thinking status; after the reply, pathname is `/ai/<new id>`, the reply shows, the list refetches.
- "carries the event from the address into a new chat" — `/ai?eventId=<uuid>` → the `POST` body has `seed: { eventId }`.
- "puts the text back when the assistant is busy" — 503 `AI_UNAVAILABLE` → the alert shows the message, the textbox value is the text again, pathname still `/ai`.
- "renames a chat in place" — click "Rename <title>", type, Enter → `PATCH` sent, new title shown; Escape cancels without a request.
- "deletes a chat after confirming, and leaves it if it was open" — open a chat, click "Delete <title>", confirm in the dialog → `DELETE` sent, row gone, pathname `/ai`.
- "shows a drafted plan as a live card under its reply" — a message with `proposalStatus: "open"` → `checkbox "Include <title>"` checked; the footer button present.
- "shows an applied plan as what it made, not a card" — `proposalStatus: "applied"`, `applied: { events: [{id,title}], tasks: [{id,title,eventId}] }` → text "Applied"; a link to `/events/<id>`; a link to `/events/<eventId>?tab=tasks` for the task; no checkbox.
- "shows a discarded plan as discarded" → text "Discarded"; no checkbox.
- "says a chat no longer exists and returns to a blank chat" — `GET …/messages` 404 → "This chat no longer exists" and the composer.
- "replaces the composer with the switched-off notice, keeping the list" — `POST` 503 `AI_DISABLED` → notice shown, no textbox, the chat links still there.

In `messages.test.tsx` add: "names an ai thread like any other" is **removed**; add nothing else (the page can no longer receive one).

Run: `npx vitest run frontend/src/routes/ai-breakdown.test.tsx` → FAIL.

- [ ] **Step 2: Write `chat-list.tsx`**

A `<nav aria-label="Chats">` styled from `messages.tsx`'s list (same classes for rows, active state and the horizontal strip below `lg`). Top: `<Button asChild><Link to="/ai"><Plus />New chat</Link></Button>`. Each row: a `<Link to={`/ai/${chat.id}`} aria-current={active ? "page" : undefined}>` holding the title (truncate) and the time, followed by two `Button variant="ghost" size="icon-xs"` with `aria-label={`Rename ${chat.title}`}` / `aria-label={`Delete ${chat.title}`}` (Pencil / Trash2 icons, `aria-hidden`).

Rename: the row swaps its link for an `<Input aria-label="Chat title">` prefilled and focused; Enter calls `onRename(chat, value)` when the trimmed value is non-empty and different; Escape or blur cancels.

Delete: opens the existing `Dialog` — title "Delete this chat?", description "“<title>” and its messages will be removed. Tasks and events it created stay.", buttons Cancel and **Delete chat** (`variant="destructive"`), which calls `onRemove(chat)`.

- [ ] **Step 3: Write `chat-thread.tsx`**

The right column: `<section aria-labelledby="ai-chat-heading" className="flex min-w-0 flex-col">`.

- Header: `<h2 id="ai-chat-heading">` with the title ("New chat" when blank); when `seedEventId`, a chip `<Link to={`/events/${seedEventId}`}>About this event</Link>`; `headerActions` on the right.
- Log: `role="log" aria-live="polite"`, an `<ol>` of turns. The bubbles, `Bot` icon and the `ThinkingTurn` move here from `ai-breakdown.tsx` unchanged. Under an assistant message:
  - `proposalStatus === "open"` and `proposal` → `<ProposalCard key={message.runId} proposal={message.proposal} members={members} busy={pending} onApply={(operations, stats) => onApply(message.runId!, operations, stats)} onDiscard={() => onDiscard(message.runId!)} />`
  - `"applied"` → a bordered note: "Applied" and a list of links — events to `/events/${id}`, tasks to `/events/${eventId}?tab=tasks` or `/tasks` when it has no event.
  - `"discarded"` → `<p className="text-sm text-muted-foreground">Discarded</p>`.
- Composer: the existing textarea + Send form. It owns the draft: on submit it clears the draft, awaits `onSend(text)`, and restores the text if that resolves `false`. With `disabled`, the "switched off" notice replaces the form.
- Empty state (no messages): "Ask what's overdue, or to plan an event."

- [ ] **Step 4: Rebuild `ai-breakdown.tsx` as the container**

```tsx
export function AiBreakdownPage() {
  const { chatId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const eventId = searchParams.get("eventId") ?? undefined;
  const members = useMembers();
  const chats = useAiChats();
  const chat = useAiChat(chatId, {
    seed: eventId ? { eventId } : undefined,
    onChatCreated: (id) => navigate(`/ai/${id}`, { replace: true }),
    onChanged: () => void chats.refresh(),
  });
  // …PageHeader "AI Assistant", then the bordered grid
  // `lg:grid-cols-[17rem_minmax(0,1fr)]` of <ChatList/> and <ChatThread/>.
}
```

`onRemove`: `await chats.remove(chat)`; if it was the open chat, `navigate("/ai")`. A `missing` chat renders the blank thread with an alert "This chat no longer exists." and navigates to `/ai`. The old `useThreads`/`useThreadMessages`/`useTasks` reads, the "Generated tasks" card and `asBriefing` are removed from this file.

In `main.tsx` add a second route `{ path: "/ai/:chatId", element: <RequireAuth><AiBreakdownPage /></RequireAuth> }`.

- [ ] **Step 5: Clean up Messages and delete `useAssistant`**

`messages.tsx`: remove `if (thread.kind === "ai") return "MAC Assistant";` and the `message.aiRunId ? "MAC Assistant" : …` branch in the message author name. Delete `use-assistant.ts` and `use-assistant.test.tsx`.

- [ ] **Step 6: Run** — `npx vitest run frontend/src` → PASS.

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck && npm run lint && npm run format:check && npm run test:unit
git add frontend/src
git commit -m "feat(ai): make AI Breakdown a list of chats beside the open one"
```

---

## Task 9: The Generated panel; events carry `aiRunId`

**Files:**

- Modify: `shared/src/schemas/event/event.ts`, `backend/src/routes/events/events.ts`, `backend/src/routes/events/events.integration.test.ts`
- Create: `frontend/src/components/ai/generated-panel.tsx`, `frontend/src/components/ai/generated-panel.test.tsx`
- Modify: `frontend/src/routes/ai-breakdown.tsx`, `frontend/src/routes/ai-breakdown.test.tsx`

**Interfaces:**

- Produces: `EventSummary.aiRunId: string | null`; `<GeneratedPanel id />`; a **Generated** toggle button in the chat header.

- [ ] **Step 1: Failing backend test** — in `events.integration.test.ts`, under `GET /api/events`: "says which assistant run made an event, and null otherwise" — seed an `ai` run and an event with that `aiRunId`, plus a plain event → the two items have `aiRunId: <run id>` and `aiRunId: null`. Run → FAIL (`undefined`).

- [ ] **Step 2: Implement**

`eventSummarySchema` gains, after `minTier`:

```typescript
  /** The assistant run that created or last changed it; null for one made by hand. */
  aiRunId: z.uuid().nullable().default(null),
```

`.default(null)` keeps every existing fixture and older client valid; the API always sends it. Add `e.ai_run_id AS "aiRunId",` to `EVENT_ROW_SELECT` and include `aiRunId` wherever the row is mapped to `EventSummary`. Run → PASS.

- [ ] **Step 3: Failing panel tests** — `generated-panel.test.tsx` (`fetch` stubbed for `/api/tasks` and `/api/events…`, inside `MemoryRouter`):

- "lists the events and tasks the assistant made, each linking to where it lives" — one AI event, one AI task on that event, one AI standing task, one hand-made task → headings "Events" and "Tasks"; links to `/events/<id>`, `/events/<eventId>?tab=tasks`, `/tasks`; the hand-made task is absent.
- "says so when the assistant has made nothing yet" → "Nothing generated yet."

Page test: "opens and closes the Generated panel" — the toggle button has `aria-expanded="false"`; click → `"true"` and the panel region is present; click again → gone.

Run → FAIL.

- [ ] **Step 4: Write `generated-panel.tsx`**

`<aside id={id} aria-label="Generated by the assistant">` using `useTasks()` and `useEvents({ includeCancelled: false })`, each filtered on `aiRunId`. Loading and error states follow the hooks' unions (a `role="status"` line; a `role="alert"` line). The toggle in `ai-breakdown.tsx`:

```tsx
<Button
  variant="outline"
  size="sm"
  aria-expanded={showGenerated}
  aria-controls="ai-generated-panel"
  onClick={() => setShowGenerated((open) => !open)}
>
  <ListChecks aria-hidden="true" />
  Generated
</Button>
```

When open, the panel renders as a third grid column at `xl` and above the log below it; the panel mounts only while open, so its reads happen on demand.

- [ ] **Step 5: Run, verify, commit**

```bash
npx vitest run frontend/src && npm run test:integration -- src/routes/events
npm run typecheck && npm run lint && npm run format:check
git add shared/src/schemas/event backend/src/routes/events frontend/src
git commit -m "feat(ai): list what the assistant has made behind a Generated toggle"
```

---

## Task 10: The briefing — prominent on Overview, pinned in AI Breakdown

**Files:**

- Modify: `frontend/src/hooks/use-briefing.ts`, `frontend/src/hooks/use-briefing.test.ts`
- Modify: `frontend/src/components/ai/briefing-card.tsx`, `frontend/src/components/ai/briefing-card.test.tsx`
- Create: `frontend/src/components/ai/briefing-panel.tsx`
- Modify: `frontend/src/components/ai/chat-list.tsx`, `frontend/src/routes/ai-breakdown.tsx`, `frontend/src/routes/ai-breakdown.test.tsx`
- Modify: `frontend/src/routes/dashboard.tsx`, `frontend/src/routes/dashboard.test.tsx`
- Modify: `frontend/src/main.tsx` (add `/ai/briefing`)

**Interfaces:**

- Consumes: backend briefing seed (Task 4).
- Produces: `useBriefing(): { state: BriefingState; retry: () => void }`; `<BriefingCard />` (Overview); `<BriefingPanel onAsk />` (`/ai/briefing`); `<AiBreakdownPage view="briefing" />`; `<ChatList showBriefing briefingActive … />`.

- [ ] **Step 1: Failing hook test** — "loads again on retry after a failure": first `fetch` 500 → `state.status === "error"`; `act(() => result.current.retry())` with the next `fetch` answering 200 → `ok`. Update the existing tests for the `{ state, retry }` shape. Run → FAIL.

- [ ] **Step 2: Failing card tests** — replace the two existing tests with:

- "shows the briefing with a way into it in AI Breakdown" → summary, bullets, link "Ask the assistant" → `/ai/briefing`.
- "says it is preparing the briefing while it loads" → `role="status"` "Preparing your briefing…".
- "says it could not prepare the briefing and offers to try again" — 503 `AI_UNAVAILABLE` → "Couldn't prepare today's briefing."; click "Try again" → a second request; then the summary.
- "renders nothing at all when the assistant is off" — 503 `AI_DISABLED` → empty container.

Run → FAIL.

- [ ] **Step 3: Failing page and dashboard tests**

`ai-breakdown.test.tsx` (the `stubApi` gains `GET /api/ai/briefing`):

- "pins today's briefing above the chats" → a link "Today's briefing" → `/ai/briefing`, before the first chat link in document order.
- "shows the briefing and starts a chat about it" — at `/ai/briefing`: summary and bullets show, the composer is labelled "Ask about this…"; send → `POST` body `{ text, seed: { briefing: true } }`; pathname becomes `/ai/<new id>`.
- "hides the pinned briefing when the assistant is off" — briefing 503 `AI_DISABLED` → no "Today's briefing" link.

`dashboard.test.tsx`: "leads the page with the briefing, above the statistics" — stub `/api/ai/briefing` 200 → the briefing heading precedes the `region`/section labelled "Overview statistics" in document order (`compareDocumentPosition`). The existing request-count assertion stays at 7.

Run → FAIL.

- [ ] **Step 4: Implement**

`use-briefing.ts`: add an `attempt` counter to state; the effect depends on it; `retry` sets `{ status: "loading" }` and increments it. Return `{ state, retry }`.

`briefing-card.tsx`: full-width `Card` with the four states of spec §5.5. Heading "Your Briefing" (`h2`), the link "Ask the assistant" → `/ai/briefing`. `disabled` → `null`.

`dashboard.tsx`: remove `<BriefingCard />` from the right rail `<aside>`; render it directly after `<PageHeader …/>` and before the "Overview statistics" section, inside a `mt-6` wrapper so it spans the content width.

`briefing-panel.tsx`: the right column for `/ai/briefing` — the briefing (or its loading / error-with-Try-again state) above a composer labelled "Ask about this…", calling `onAsk(text): Promise<boolean>`.

`chat-list.tsx`: when `showBriefing`, a pinned `<Link to="/ai/briefing" aria-current={briefingActive ? "page" : undefined}>` with a `Sparkles` icon and "Today's briefing", separated from the chats by a border.

`ai-breakdown.tsx`: accepts `view?: "briefing"`. In that view it calls `useAiChat(undefined, { seed: { briefing: true }, … })` and renders `<BriefingPanel onAsk={chat.send} />` in the right column. `showBriefing` is `briefing.state.status !== "disabled"`.

`main.tsx`: add `{ path: "/ai/briefing", element: <RequireAuth><AiBreakdownPage view="briefing" /></RequireAuth> }` **before** `/ai/:chatId`.

- [ ] **Step 5: Run, verify, commit**

```bash
npx vitest run frontend/src
npm run typecheck && npm run lint && npm run format:check && npm run test:unit
git add frontend/src
git commit -m "feat(ai): lead the Overview with the briefing and pin it in AI Breakdown"
```

---

## Task 11: E2E, docs, and the full gate

**Files:**

- Modify: `e2e/ai.spec.ts`
- Modify: `docs/api-endpoints.md`, `docs/prd.md`
- Modify: `docs/superpowers/specs/2026-09-23-ai-assistant-design.md` (one line pointing at the newer spec)

- [ ] **Step 1: Rewrite `e2e/ai.spec.ts`**

Keep the file's approach: sign in, and answer **every** `**/api/ai/**` call in the browser. Default stub: `GET /api/ai/chats` → two chats; `GET /api/ai/chats/<id>/messages` → a conversation whose last reply has an open plan (one event, two tasks); `GET /api/ai/briefing` → a fixed briefing; everything else 503 `AI_DISABLED`.

Specs:

- "lists chats and opens one with its plan as a card" — `/ai` shows both titles and "New chat"; click one → the card's footer reads `Create 1 event + 2 tasks`; uncheck a task → `Create 1 event + 1 task`. Axe scan of `main`, in **light and dark**.
- "shows the briefing on the Overview and in AI Breakdown" — `/` shows "Your Briefing" above the statistics; `/ai` shows the pinned "Today's briefing"; opening it shows the summary. Axe scan of `/ai/briefing`.
- "shows no assistant chat in Messages" — `/messages` has no thread named after either stubbed chat and no "MAC Assistant".
- "says the assistant is off when it is, and still lists chats" — sending answers 503 `AI_DISABLED` → the notice; the two chat links remain.

- [ ] **Step 2: Run** — `E2E_MEMBER_EMAIL=… E2E_MEMBER_PASSWORD=… npm run test:e2e` → PASS.

- [ ] **Step 3: Update `docs/api-endpoints.md`**

In `## AI`: add the chat endpoints table (spec §4.1) with `AiChat` / `AiChatMessage`; change `POST /api/ai/messages` to `{ chatId?, text, seed? }` → `{ chatId, runId, reply, proposal }` and describe lazy creation, memory and the two seeds; add `PROPOSAL_CLOSED` and the discard endpoint; say the briefing lives on its run; under Threads, say `ai` channels are never served.

- [ ] **Step 4: Update `docs/prd.md`** — R15's row: multiple chats with memory, saved plans, the briefing on Overview and pinned in AI Breakdown are built; remove "listing AI-created events in the `/ai` rail" from what remains.

- [ ] **Step 5: Point the old spec at the new one** — under the header of `2026-09-23-ai-assistant-design.md` add: `**Superseded in part by:** [`2026-09-30-ai-multi-chat-design.md`](2026-09-30-ai-multi-chat-design.md) (§9 there lists what changed).`

- [ ] **Step 6: Run the full gate**

```bash
npm run typecheck && npm run lint && npm run format:check
npm run test:unit
npm run test:integration
E2E_MEMBER_EMAIL=… E2E_MEMBER_PASSWORD=… npm run test:e2e
```

Run the three test suites one at a time: a single `npm run verify` has been killed for memory on the 8 GB development machine.

- [ ] **Step 7: Try it against the real model** — with `AI_ENABLED=1`: start a chat ("plan a poker bot hackathon"), follow up ("make the first task urgent"), reload the page, apply the plan, open the briefing and ask about it. Record what happened in the ledger.

- [ ] **Step 8: Commit**

```bash
git add e2e docs
git commit -m "docs(ai): document assistant chats and cover them end to end"
```

---

## Risks

| Risk                                                                         | Likelihood | Mitigation                                                                                                                                         |
| ---------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| The generated migration orders the FK change after a statement that needs it | Medium     | Task 1 Step 7 reads the SQL before applying; the `DELETE` is appended last by hand; `seed-demo.integration.test.ts` applies it to a fresh database |
| Memory makes prompts too long for the small model                            | Medium     | 6000-character budget, 40 messages, words only; the live check in Task 11 Step 7 includes a follow-up turn                                         |
| The page refetches the chat it just created and flickers                     | Medium     | `loadedFor` ref, pinned by a hook test                                                                                                             |
| Two applies of one plan                                                      | Low        | Conditional `UPDATE` claim first in the transaction, pinned by a concurrent test                                                                   |
| Existing frontend fixtures break on `aiRunId`                                | Low        | `.nullable().default(null)`                                                                                                                        |
