# AI assistant — design spec

**Date:** 2026-09-23
**Branch:** `gkur0003/ai-assistant` (not yet cut)
**Status:** approved, not yet implemented
**Implementation plan:** [`../plans/2026-09-23-ai-assistant.md`](../plans/2026-09-23-ai-assistant.md)

---

## 1. What this is

R15 in one sentence: a member opens `/ai`, asks for something in plain English,
and the assistant reads the club's live data, proposes the work, and — once a
human confirms — creates or changes it **under that member's own permissions**.

Three surfaces:

| Surface            | What it is                                                            |
| ------------------ | --------------------------------------------------------------------- |
| `/ai`              | The assistant. A chat that reads live club data and proposes work.    |
| Dashboard          | A generated daily briefing over the data the dashboard already loads. |
| Event → Thread tab | Thread summary: bullets and action items.                             |

The design turns on one property, written into
`backend/src/db/schema/ai-run.ts` before this spec existed:

> **THE AI ACTS AS THE REQUESTING USER**: it calls the same service functions the
> HTTP routes call, so it inherits their permissions and cannot exceed them.

Everything below is an elaboration of that sentence.

---

## 2. Decisions taken

| #   | Decision                                                                                                   | Why                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Two AI surfaces plus one panel: the `/ai` chat, a dashboard briefing card, an event thread summary.        | The chat is where work happens; the briefing is what makes the assistant worth opening each morning.                              |
| D2  | The assistant **reads live club data through tools**.                                                      | It can answer questions nobody pre-planned — "who is overloaded before O-Week?" — as well as drafting.                            |
| D3  | **The assistant acts as the caller.** Every tool runs the same service function the equivalent route runs. | Makes privilege escalation structurally impossible rather than audited. Already `ai-run.ts`'s stated intent.                      |
| D4  | **A human confirms before any write.** The proposal lives in the card until approved.                      | Keeps the database the single record of committed work: a row exists once a person has agreed to it.                              |
| D5  | **Finance is readable; money mutations have no tool.** Rule 13, in `ai-run.ts`.                            | The assistant can answer "can we afford this?", and approving an expense stays a human action where a mistake costs real money.   |
| D6  | **Create and update only.**                                                                                | Everything the assistant can do is undoable by hand, so a mis-click is cheap to recover from.                                     |
| D7  | **One proposal card per assistant turn**, titled sections inside, one commit button.                       | A mixed plan — an event plus the tasks hanging off it — is one decision, and one transaction.                                     |
| D8  | **Create rows show values; update rows show `before → after`.**                                            | Structural rather than decorative, so it survives colour and icons being stripped. An update cannot be judged without its before. |
| D9  | **Section identity is derived from the payload.**                                                          | The presentation is computed from what was proposed, so a mislabelled section is impossible.                                      |
| D10 | **Rows are directly editable, field by field.**                                                            | The common correction is one field on one row: click it, change it, done.                                                         |
| D11 | **Conversational edit for structure, direct edit for correction.**                                         | "Push everything a week later" is worth a model round-trip; fixing a typo is worth a text input.                                  |
| D12 | **Max 30 proposals per turn**, the card scrolling internally with the footer pinned.                       | Every proposed row passes through the viewport before it can be approved, and the running count stays visible while you scroll.   |
| D13 | **The model emits handles, never UUIDs.** Read tools issue them; the server resolves them.                 | A hallucinated identifier cannot reach a query, and two events can each have a task called "Book venue".                          |
| D14 | **`dueOffsetDays` relative to `event.starts_at`** in planning proposals.                                   | The server does the date arithmetic in `CLUB_TIMEZONE`, and an offset is the part that generalises across events.                 |
| D15 | **The briefing is stored as a message** in the caller's `ai` channel, stamped with `ai_run_id`.            | One generation per member per day survives serverless, and the briefing lands in the assistant's own history where it belongs.    |
| D16 | **`proposed` / `kept` / `edited` counts are recorded on `ai_run`.**                                        | Evaluation data for the report, captured from the confirmation the member was already making. Read at write-up time.              |

---

## 3. Surfaces

### 3.1 `/ai` — the assistant

`frontend/src/routes/ai-breakdown.tsx` becomes the chat. Its right rail —
"Generated tasks", filtered on `aiRunId` — stays as R15's history requirement,
widened to count events as well.

Messages persist to the member's `ai` channel, so `useThreads` and
`useThreadMessages` keep working and history costs nothing new.

Entry points are links: the nav entry that already exists, the briefing card's
footer, and a "Plan with AI" button on `event-detail.tsx`'s Tasks tab. Each
seeds the first message.

### 3.2 Dashboard — the briefing card

A generated paragraph plus two to four bullets over what the dashboard already
fetches: the caller's open tasks, club tasks, the `[today, +7d)` event window,
and committee load.

```
  ┌─ AI Briefing ─────────────────────────────────┐
  │  Three tasks slipped past due this week, all  │
  │  on O-Week Booth.                             │
  │                                               │
  │  • Ben has 9 open tasks — double anyone else  │
  │  • Hackathon 2026 is in 6 days, no tasks yet  │
  │  • #general has 14 unread                     │
  │                                               │
  │  Ask the assistant →                          │
  └───────────────────────────────────────────────┘
```

Per D15 the briefing is a message in the caller's `ai` channel.
`GET /api/ai/briefing` looks for one created today in `CLUB_TIMEZONE`; finding
none, it generates, stores and returns one. A page refresh costs nothing, and
the same briefing is visible in the assistant's own thread.

The card renders only while `AI_ENABLED` is on. A deployment without the
assistant shows the dashboard it has today.

### 3.3 Event → Thread tab — the summary

Bullets and action items over a thread the caller can already read, reusing the
threads route's own visibility check. Ephemeral and re-runnable: a summary
written at message 40 is wrong by message 90, so each request summarises the
thread as it stands.

An in-process cache on `(channelId, latestMessageId)` saves a call when a tab is
reopened locally. Production is Vercel serverless, where process memory does not
survive between invocations, so `AI_DAILY_RUN_CAP` is the quota guard that
matters.

---

## 4. The tool surface

One module, `backend/src/routes/ai/tools/`, exporting a registry. Every tool is
a framework-free function taking a `Tx` and the caller's identity — the shape
`routes/events/service.ts` already uses — so tools are unit-testable against a
fake completion function with no database and no network.

### 4.1 Read tools

Each returns the rows the caller could read through the equivalent route.

| Tool               | Reads                                             | Notes                                                 |
| ------------------ | ------------------------------------------------- | ----------------------------------------------------- |
| `listTasks`        | `GET /api/tasks` filters                          | Returns handles alongside each row.                   |
| `listOverdueTasks` | `GET /api/tasks/overdue`                          | Serves "what's late?" off the existing partial index. |
| `listEvents`       | `GET /api/events` filters                         |                                                       |
| `getEventProgress` | `GET /api/events/:id/progress`                    | Task completion for one event.                        |
| `listMembers`      | The roster, each with an open-task count          | The committee-load data Smart-assign runs on.         |
| `pastEventPlans`   | Past events by `starts_at desc`, with their tasks | The planning corpus, bounded by `PLAN_CORPUS_EVENTS`. |
| `readThread`       | Messages in one channel                           | Gated by the threads route's `assertCanReadChannel`.  |
| `readBudget`       | `GET /api/budget`                                 | Read only (D5).                                       |

`pastEventPlans` orders by recency because `event` has a `status`
(`planning | live | wrapped | cancelled`) and no type or category column. If one
is added later, narrowing the corpus by it is a one-line change inside that
tool.

### 4.2 Proposal tools

These stage a proposal into the card and return an acknowledgement to the model.

| Tool                 | Stages                                                  |
| -------------------- | ------------------------------------------------------- |
| `proposeCreateEvent` | One event.                                              |
| `proposeCreateTasks` | 1–30 tasks, each optionally bound to a staged event.    |
| `proposeUpdateTasks` | Field diffs on existing tasks, addressed by handle.     |
| `proposeUpdateEvent` | Field diffs on one existing event, addressed by handle. |

Reassignment is `proposeUpdateTasks` where the diffs touch only `assigneeIds`;
the card derives that label itself (§5.2).

`proposeUpdateEvent`'s status field is a zod enum of
`planning | live | wrapped`, so the values it can propose are exactly the ones
tier 1 may set through `PATCH /api/events/:id/status`. Cancellation stays with
the president, through `DELETE /api/events/:id`.

### 4.3 Handles and refs

A read tool numbers the rows it returns — `T1`, `T2`, `E1`, `M1` — and keeps the
handle→id map for the life of the request. The model emits handles; a handle the
run never issued is `422 AI_OUTPUT_INVALID`.

**Handles never leave the backend.** The chat endpoint resolves them before it
responds, so the card holds real ids and carries each diff's `before` value
ready to render. That is what lets the apply endpoint (§6) take an ordinary
payload of ids: the model emits no identifier, and the client resolves nothing.

Three proposal shapes follow from that, each with one job — what the model emits
(handles), what the client renders (ids plus each diff's `before`), and what the
client posts back (ids).

A **ref** (`$event1`) is the one symbolic thing that does reach the client: it
names a row staged in the same card that does not exist yet, so a task can be
bound to an event being created alongside it. The server substitutes refs as it
creates their targets (§5.4).

### 4.4 Permission model

Two layers, the second of which is the security boundary.

**The advertised toolset is filtered by the caller's tier**, so the assistant
proposes work the member can actually do. This is a UX measure.

**Every operation is re-checked at apply time, server-side, as the caller**,
against the same gate its equivalent route uses:

| Proposal operation       | Mirrors                        | Gate             |
| ------------------------ | ------------------------------ | ---------------- |
| Create event             | `POST /api/events`             | tier 1           |
| Create one task          | `POST /api/tasks`              | tier 0           |
| Create two or more tasks | `POST /api/tasks/bulk`         | tier 1           |
| Update task              | `PATCH /api/tasks/:id`         | tier 0           |
| Update task status       | `PATCH /api/tasks/:id/status`  | tier 0           |
| Update event             | `PATCH /api/events/:id`        | owner, or tier 1 |
| Update event status      | `PATCH /api/events/:id/status` | tier 1           |

The single/bulk asymmetry mirrors what the existing API does, so "what the
assistant can do" needs no second document: it is what the member can do.

A tool call the caller's tier does not cover is returned **to the model as a
tool result**, so the assistant says it cannot do that — which is the right
experience for the member reading it.

### 4.5 The write surface

The four proposal tools in §4.2 are the assistant's entire write surface, and
each of them goes through a human confirmation. Money (`expense`, `budget`,
`event.allocation_cents`), deletion, event cancellation, role changes and invite
creation have no tool at all — a boundary held by the registry's contents rather
than by a runtime check.

---

## 5. The proposal card

### 5.1 Anatomy

```
  ✦ Assistant                                            14:02
  Hackathon 2026 isn't in the calendar yet, so I've drafted the
  event plus the 8 tasks Hackathon 2025 ran with.

  ┌──────────────────────────────────────────────────────────┐
  │  ＋ Create event                                     1   │ ▲
  │  ──────────────────────────────────────────────────────  │ │
  │  ☑  Hackathon 2026                                       │ │
  │       14 Oct 2026, 09:00  →  15 Oct 2026, 18:00          │ ▓
  │       Woodside Building                                  │ ▓
  │                                                          │ ▓  scrolls
  │  ＋ Create tasks              on Hackathon 2026      8   │ ▓
  │  ──────────────────────────────────────────────────────  │ │
  │  ☑  Book venue + AV            Ben Ng         3 Sep      │ │
  │  ☑  Confirm sponsor deck       Mia Tran      10 Sep      │ ▼
  ├──────────────────────────────────────────────────────────┤
  │   [ Create 1 event + 7 tasks ]    [ Discard ]            │  pinned
  └──────────────────────────────────────────────────────────┘
```

An update card, where every row is a diff:

```
  ┌──────────────────────────────────────────────────────────┐
  │  ✎ Update event                                      1   │
  │  ──────────────────────────────────────────────────────  │
  │  ☑  Industry Night                                       │
  │       starts   12 Nov, 18:00   →   20 Nov, 18:00         │
  │       ends     12 Nov, 21:00   →   20 Nov, 21:00         │
  │                                                          │
  │  ⇄ Reassign tasks                                    3   │
  │  ──────────────────────────────────────────────────────  │
  │  ☑  Print name badges      Ben Ng (9)  →  Aisha K (2)    │
  │  ☑  Brief the judges       Ben Ng (9)  →  Aisha K (2)    │
  │  ☐  Book venue + AV        Ben Ng (9)  →  Mia Tran (3)   │
  │                                                          │
  │   [ Apply 4 changes ]    [ Discard ]                     │
  └──────────────────────────────────────────────────────────┘
```

The footer button's label names what will happen, and its count tracks the
checkboxes live.

### 5.2 Section derivation

Sections come from `(operation, entity)` read off the payload (D9):

| Payload                                                   | Renders as       |
| --------------------------------------------------------- | ---------------- |
| `create` + `event`                                        | ＋ Create event  |
| `create` + `task`                                         | ＋ Create tasks  |
| `update` + `event`                                        | ✎ Update event   |
| `update` + `task`                                         | ✎ Update tasks   |
| `update` + `task`, every diff touching only `assigneeIds` | ⇄ Reassign tasks |

Icons are `Plus` / `Pencil` / `ArrowLeftRight` from lucide, `aria-hidden`, with
the text label carrying the meaning.

### 5.3 Editing

Every field on a create row is directly editable (D10). On a diff row the
**after** value is editable and the before is immutable text; unchecking is how
a row is excluded, which keeps `DiffRow` simple and keeps an edit from
repointing a change at a different row.

Three cells, all of which already exist:

| Cell     | Component                                                                                   |
| -------- | ------------------------------------------------------------------------------------------- |
| Title    | `components/ui/input.tsx`                                                                   |
| Assignee | `components/tasks/assignee-field.tsx` — Radix `Popover`, search, avatars, `max-h-48` scroll |
| Due date | `components/ui/date-time-picker.tsx`                                                        |

Checkboxes are native `<input type="checkbox">`, matching
`task-filters.tsx:101`: a native checkbox brings keyboard behaviour and ARIA for
free and satisfies `jsx-a11y`. **The card adds no new `ui/` primitive.**

Each edited row is `safeParse`d against `createTaskSchema` and the event schemas
from `@ctp/shared` — the same schemas `task-create-dialog.tsx` uses and the same
ones the apply endpoint validates against. A checked row that fails disables the
footer button and marks itself, so a problem surfaces while it can still be
fixed in place.

`+ Add a task` at the foot of a create section lets a member extend a plan by
hand, reusing the same row component.

**Edits survive refinement.** When the next message is sent, the _current edited
card_ is what goes back to the model as context, so "give catering to Mia"
builds on the title fixed three rows up.

### 5.4 Dependencies and the transaction boundary

Tasks proposed against a staged event carry that event's ref. On apply, the
server creates the event first and substitutes the real id.

In the card, unchecking the event **disables its dependent task rows**: a task
belongs to an event that is being created.

One approval is one `Tx`. Every checked operation lands together, so the board
after a confirmation is the plan that was on screen.

### 5.5 Overflow

The model is capped at 30 proposals per turn, enforced as a prompt constraint
and as `.max(30)` on the shared schema. Longer plans are a conversation.

Longer cards scroll internally, footer pinned outside the scroll region, using
the pattern already established in `dashboard-search.tsx:117`,
`assignee-field.tsx:166` and `ui/dialog.tsx:79`:
`max-h-[…] overflow-y-auto overscroll-contain`. Under about ten rows the list
sits at its natural height.

---

## 6. Applying a proposal

```
POST /api/ai/proposals/apply     tier 0 — each operation gated individually
```

```json
{
  "runId": "<uuid>",
  "operations": [
    { "op": "create", "entity": "event", "ref": "$event1", "data": {} },
    { "op": "create", "entity": "task", "data": { "eventRef": "$event1" } },
    { "op": "update", "entity": "task", "id": "<uuid>", "data": { "assigneeIds": [] } }
  ],
  "stats": { "proposed": 9, "kept": 7, "edited": 2 }
}
```

Returns `201 { events: [], tasks: [] }`.

The payload is the **edited** card, so by this point it is an ordinary form
submission that happens to carry AI provenance. It is re-validated against the
shared schemas and re-authorised per operation (§4.4) exactly as if each had
arrived at its own route. Rows created or changed carry `ai_run_id`.

`stats` is written to `ai_run` (D16), computed by the client because that is
where the checkbox and edit state lives.

---

## 7. Privacy (R14)

`docs/prd.md` R14 says _"Monash privacy; no external sharing."_ This design
sends club data to a third-party API: event and task titles, member names,
committee workload, budget figures, and — through the thread summary —
**members' message text**. Google AI Studio's free-tier terms permit Google to
use free-tier prompts to improve its products, which paid tiers do not.

That is external sharing under any reasonable reading. Three things follow, and
were agreed on 2026-09-23:

1. `.env.example` and `docs/setup.md` state plainly that free-tier prompts leave
   Monash infrastructure and may be retained. Both now do.
2. **`AI_ENABLED` defaults to off.** AI is opt-in per deployment.
3. The final report carries a paragraph under R14 saying so.

Thread summaries cover `team` and `event` channels, which are the ones a
committee shares. Budget figures are readable so the assistant can answer "can
we afford this?"; money mutations stay a human action (D5).

**Prompt injection.** Thread messages and task titles are member-authored text
flowing into prompts. The blast radius is small by construction: the model's
only write path is a proposal a human reads and approves, and every proposal
must satisfy a zod schema first. The worst achievable outcome is a bad draft
that someone declines. Note it in the report; the schema gate and the
confirmation are the defences.

---

## 8. Config, errors, storage

### 8.1 Environment

Read in `backend/src/config/ai.ts`. Setup steps live in `docs/setup.md`.

| Variable           | Default            | Meaning                                                                |
| ------------------ | ------------------ | ---------------------------------------------------------------------- |
| `AI_ENABLED`       | _(empty = off)_    | `1` turns the AI endpoints on; otherwise they 503.                     |
| `GEMINI_API_KEY`   | _(empty)_          | Google AI Studio key.                                                  |
| `GEMINI_MODEL`     | `gemini-2.5-flash` | Free-tier model id — a variable because these names change.            |
| `AI_DAILY_RUN_CAP` | `50`               | `ai_run` rows per member per rolling 24h, counted off `ai_run` itself. |

### 8.2 Errors

Typed errors thrown by the service and mapped to status codes by the route, all
rendering the shared `ApiError` shape.

| Error             | Status | Code                | When                                                       |
| ----------------- | ------ | ------------------- | ---------------------------------------------------------- |
| `AiDisabledError` | 503    | `AI_DISABLED`       | `AI_ENABLED` is off, or no key                             |
| `AiQuotaError`    | 429    | `AI_QUOTA_EXCEEDED` | Daily cap reached, or Gemini returned 429                  |
| `AiOutputError`   | 422    | `AI_OUTPUT_INVALID` | Both attempts failed zod validation, or an unissued handle |

### 8.3 Storage and the migration

Already present: `ai_run` (with its `steps` jsonb tool trace), `task.ai_run_id`,
`message.ai_run_id`, `channel.kind = 'ai'`.

An `ai` channel is created on first use with `name: "Assistant"`, `min_tier: 0`
and both `team_id` and `event_id` NULL, which is what
`channel_named_unless_dm_check`, `channel_min_tier_only_when_tier_gated_check`
and `channel_parent_matches_kind_check` require.

One migration in `backend/drizzle/`, generated by `npm run db:generate` and
applied by `npm run db:migrate`:

1. `ai_run.proposed_count`, `ai_run.kept_count`, `ai_run.edited_count` —
   nullable integers, written on apply (D16).
2. `event.ai_run_id` — nullable uuid, FK to `ai_run`, `ON DELETE SET NULL`,
   mirroring `task.ai_run_id`, so an assistant-created event carries the same
   provenance a task does.

---

## 9. Testing

Per `docs/contributing.md`'s three tiers.

**Unit** — DB-free and network-free, the provider a fake `CompletionFn`: handle
issue and resolution, section derivation, diff computation, dependency
ordering, prompt assembly, the 30-proposal cap, and every zod schema.

**Integration** — supertest against the real app and Docker Postgres, the
provider stubbed: each gate in §4.4 from both sides, an unissued handle
returning 422, a bad reference rolling the whole apply back, and `AI_ENABLED=0`
503ing every endpoint.

**E2E** — with AI off, which is the default: `/ai` renders its disabled state
and the dashboard shows its usual widgets. One spec with the provider stubbed on
runs an axe scan over a rendered proposal card, the most complex interactive
surface in the app.

Frontend hooks and components get colocated `.test.ts` / `.test.tsx` files.

---

## 10. Scope boundary

- **Money mutations.** Rule 13 (D5) — the assistant reads finance and proposes
  nothing against it.
- **Deletion and event cancellation.** D6 — both stay manual, and cancellation
  stays with the president.
- **Streaming responses.** A proposal card renders from a complete payload, so
  streaming would buy nothing here.
- **Gemini's native `responseSchema`.** The zod `safeParse` happens regardless,
  so a zod-to-OpenAPI converter would buy a slightly lower retry rate at the
  cost of a provider lock. If retries prove common, it goes inside
  `geminiComplete` as a pure optimisation and nothing outside that file changes.
