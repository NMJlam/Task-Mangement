# AI assistant — multiple chats: design spec

**Date:** 2026-09-30
**Branch:** `gkur0003/ai-assistant`
**Status:** design approved in conversation; awaiting review of this document
**Builds on:** [`2026-09-23-ai-assistant-design.md`](2026-09-23-ai-assistant-design.md)
(the assistant as built). Where the two disagree, this document wins; §9 lists
exactly what it replaces.

---

## 1. What this is

Today each member has **one** assistant conversation, stored as a single `ai`
channel, which also appears in the Messages page as `#assistant`. Every message
is answered on its own: the model never sees what was said before.

This change makes the assistant work like ChatGPT or Claude:

- A member has **many chats**. The AI Breakdown tab shows them in a list beside
  the open chat, laid out like the Messages page, with a **New chat** action.
- A chat **remembers itself**: each reply sees that chat's recent messages.
- A drafted plan **stays with its chat** until it is applied or discarded.
- AI chats appear **only in AI Breakdown**. The Messages page holds human
  conversations only.
- The **daily briefing is more prominent**: full width at the top of the
  Overview page, and pinned at the top of the chat list in AI Breakdown, where
  asking about it starts a chat.

What does not change: the tools, the permission model ("the assistant acts as
the caller"), the proposal card, apply's per-operation gates, and the thread
catch-up panel as the member sees it.

---

## 2. Decisions taken

| #   | Decision                                                                                                      | Why                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | **A chat is a `channel` of kind `ai`**, many per member, the member its only `chan_member`.                   | Reuses message storage and membership privacy that already work and are tested. `channel.ts`: "a dedicated PAGE, not a schema".        |
| M2  | **A chat remembers its own recent messages**, trimmed to a character budget from the oldest end.              | "Now make it urgent" has to work. The budgeter already exists for thread summaries.                                                    |
| M3  | **Handles stay per-reply.** Memory carries words, never handles or ids.                                       | The model re-reads through its tools every turn, so memory cannot smuggle in an identifier it was not shown under current permissions. |
| M4  | **Briefings and summaries are runs, not chat messages.** `ai_run.channel_id` becomes optional.                | The chat list shows only conversations the member started. Replaces D15 of the earlier spec.                                           |
| M5  | **The chat title is its first message**, trimmed, and **renamable**.                                          | Instant, costs no model call, and never invents anything.                                                                              |
| M6  | **A chat can be deleted.** Its runs survive with the chat link cleared.                                       | Tasks and events it created keep their `ai_run_id` provenance, and the kept/edited evaluation counts are not lost.                     |
| M7  | **A drafted plan is saved on its run** with a status: `open`, `applied` or `discarded`.                       | Leaving a chat and coming back shows the card again; an applied plan shows what it made instead of a live card.                        |
| M8  | **"New chat" writes nothing until the first message succeeds.**                                               | Empty chats never accumulate, and a failed first turn leaves nothing behind.                                                           |
| M9  | **A chat may be tied to one event** (`seed_event_id`), kept in view for every turn of that chat.              | "Plan with AI" on an event page opens a chat about that event; with memory, the context must outlive the first message.                |
| M10 | **The threads API never serves an `ai` channel.**                                                             | Enforced server-side, so no page can list, read or post into an AI chat except through the assistant's own endpoints.                  |
| M11 | **The old single Assistant conversations are deleted** by the migration.                                      | Decided in review: a clean start. Runs are kept (M6), so provenance and evaluation data survive.                                       |
| M13 | **The briefing leads the Overview page**: full width, above the stat strip, never silently absent.            | It was a small card in the right rail that vanished on any failure, so a member could go days without knowing it existed.              |
| M14 | **The briefing is pinned at the top of the chat list**, and asking about it starts a chat that opens with it. | One click from any chat; the new chat begins with the briefing as the assistant's first message, so memory (M2) carries it.            |
| M12 | **Two columns like Messages**, with everything the assistant has made behind a **Generated** toggle.          | The page reads as a chat first; the provenance view is one click away rather than a permanent third column.                            |

---

## 3. Data model

### 3.1 `channel`

- `kind = 'ai'` no longer means "the member's one assistant channel". A member
  may own any number. `name` is the chat's title (the existing
  `channel_named_unless_dm_check` already requires a non-blank name).
- New column **`seed_event_id uuid NULL`** → `event(id)` **`ON DELETE SET NULL`**.
  - CHECK `channel_seed_only_on_ai_check`: `seed_event_id IS NULL OR kind = 'ai'`.
  - Added to `channel_uuid_shape_check`.
  - It is a separate column, not `event_id`, because `event_id` means "this
    channel is that event's thread": `channel_parent_matches_kind_check` forbids
    it on an `ai` channel, and its foreign key cascades, which would delete a
    chat when its event row is deleted.

### 3.2 `ai_run`

| Column            | Change                                                                           | Holds                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `channel_id`      | `NOT NULL` dropped; FK becomes **`ON DELETE SET NULL`** (was CASCADE).           | chat run: its chat. summary run: the thread summarised. briefing run: `NULL`.                           |
| `kind`            | **new**, `text NOT NULL DEFAULT 'chat'`, CHECK in `chat`, `briefing`, `summary`. | What the run was. Replaces recognising a briefing by its prompt text.                                   |
| `result`          | **new**, `jsonb NULL`.                                                           | chat run: the resolved proposal (`AiResolvedProposal`), if one was drafted. briefing run: the briefing. |
| `proposal_status` | **new**, `text NULL`, CHECK in `open`, `applied`, `discarded`.                   | Set only on a chat run that drafted a plan. CHECK: `proposal_status IS NULL OR kind = 'chat'`.          |

The header comment in `ai-run.ts` ("no proposal-and-accept table") stays true:
these are columns on the run, not a second table.

### 3.3 `message`

Unchanged. A chat holds the member's messages (`author` = the member) and the
assistant's replies (`author` NULL, `ai_run_id` set). A reply's `ai_run_id` is
how the page finds the plan that belongs under it.

### 3.4 `event` (API shape only)

The event response schema in `@ctp/shared` gains `aiRunId` (the column already
exists). This is what lets the Generated panel list assistant-created events.

### 3.5 Migration `0011`

On top of `0010_perfect_bushwacker`. Generated by `npm run db:generate`, then
the data statements below are added by hand, **in this order**:

1. Schema changes of §3.1 and §3.2. The `ai_run.channel_id` foreign key must be
   `SET NULL` **before** step 3, or deleting the channels would delete the runs.
2. `UPDATE ai_run SET kind = 'briefing' WHERE prompt = 'Daily briefing'` and
   `SET kind = 'summary' WHERE prompt LIKE 'Summarise thread %'`. Everything
   else keeps the default `chat`.
3. `DELETE FROM channel WHERE kind = 'ai'` (M11). Their messages and memberships
   go with them by cascade; their runs stay with `channel_id` cleared.

Consequences: no member has a chat after the migration; existing runs have no
`result`, so today's briefing regenerates once on the next dashboard visit, and
no pre-migration plan can be applied. The demo seed's `assistant` channel
(`seed-demo.ts`) is removed. Only local and demo databases hold assistant data;
the feature has never reached production.

---

## 4. API

All tier 0. A chat belongs to exactly one member: every endpoint below treats a
chat that is not the caller's, or does not exist, as **404 `CHAT_NOT_FOUND`** —
never 403, which would confirm it exists. All shapes are zod schemas in
`shared/src/schemas/ai/ai.ts`; that file stays the source of truth.

### 4.1 New

| Endpoint                                | Input       | Success                                                         |
| --------------------------------------- | ----------- | --------------------------------------------------------------- |
| `GET /api/ai/chats`                     | —           | `200 { chats: AiChat[] }`, most recently active first           |
| `GET /api/ai/chats/:id/messages`        | —           | `200 { chat: AiChat, messages: AiChatMessage[] }`, oldest first |
| `PATCH /api/ai/chats/:id`               | `{ title }` | `200 { chat: AiChat }`                                          |
| `DELETE /api/ai/chats/:id`              | —           | `204`                                                           |
| `POST /api/ai/proposals/:runId/discard` | —           | `204`                                                           |

```ts
AiChat        = { id, title, seedEventId: uuid | null, lastMessageAt, createdAt }
AiChatMessage = {
  id, role: "member" | "assistant", body, createdAt,
  runId: uuid | null,                      // assistant replies only
  proposal: AiResolvedProposal | null,     // the run's saved plan
  proposalStatus: "open" | "applied" | "discarded" | null,
  applied: { events: {id,title}[], tasks: {id,title}[] } | null   // when applied
}
```

- `title` on PATCH: trimmed, 1–80 characters.
- `applied` is read from provenance: the events and tasks whose `ai_run_id` is
  that run, filtered by what the caller can see now.
- These endpoints do **not** return `503 AI_DISABLED`: reading, renaming and
  deleting old chats works with the assistant switched off. Only endpoints that
  call the model, or apply its output, require it enabled.
- Discard: the run must be the caller's chat run with `proposal_status = 'open'`;
  otherwise `404 RUN_NOT_FOUND` or `409 PROPOSAL_CLOSED`.

### 4.2 Changed: `POST /api/ai/messages`

Request `{ chatId?: uuid, text, seed?: { eventId } | { briefing: true } }`; response
`{ chatId, runId, reply, proposal }`.

- **With `chatId`**: the caller's chat, else `404 CHAT_NOT_FOUND`. `seed` is
  ignored; the chat's own `seed_event_id` applies.
- **Without `chatId`**: a new chat. Nothing is written until the turn succeeds;
  then the chat is created in the same transaction as the run and the two
  messages, titled from `text` (whitespace collapsed, cut to 60 characters with
  an ellipsis) and seeded from `seed.eventId` if the caller can see that event.
- **Memory (M2)**: the prompt gains a `CONVERSATION SO FAR` block — the chat's
  most recent messages (at most 40), passed through the existing
  `budgetMessages` with a budget of 6000 characters, as `MEMBER:` / `ASSISTANT:`
  lines. Only message text is carried: no tool results, no handles (M3).
- **Briefing seed (M14)**: `seed` may instead be `{ briefing: true }`, on a
  new chat only. The chat is created with today's briefing as its first
  message — an assistant message stamped with the briefing run's id, its body
  the summary followed by one `- ` line per bullet — placed before the member's
  own message. That first turn's `CONVERSATION SO FAR` block therefore already
  contains it, and so does every later turn's. If the caller has no briefing
  for today, the seed is ignored and the chat starts normally.
- **Seed (M9)**: each turn, if the chat's `seed_event_id` is still visible to
  the caller, the context line and a fresh handle for that event are issued as
  today. If it is not visible, it is silently absent.
- **Saved plan (M7)**: a run that drafted a proposal stores the resolved
  proposal in `result` with `proposal_status = 'open'`.
- **Failure**: a turn that fails (`AI_UNAVAILABLE`, `AI_OUTPUT_INVALID`,
  `AI_QUOTA_EXCEEDED`) writes no chat and no message. An `AI_OUTPUT_INVALID`
  turn still records its run toward the daily cap, as now (with `channel_id`
  set only if the chat already existed).

### 4.3 Changed: `POST /api/ai/proposals/apply`

Unchanged in shape. It now also requires the run's `proposal_status = 'open'`
and sets it to `'applied'` in the same transaction. Otherwise
`409 PROPOSAL_CLOSED`. This makes a double click, or applying an old card from a
second tab, a refusal rather than a duplicate plan.

### 4.4 Changed: threads API (M10)

`'ai'` is removed from the membership kinds in `routes/threads/service.ts`
(`visibleThreads`, and everything built on it). Effect: `GET /api/threads` never
lists an AI chat, and reading, posting to or marking read an `ai` channel through
the thread routes answers the same 404 as any thread the caller cannot see. The
assistant's endpoints use their own ownership check (`kind = 'ai'` and a
`chan_member` row for the caller).

### 4.5 Unchanged from outside: briefing and summary

`GET /api/ai/briefing` and `POST /api/ai/threads/:id/summary` keep their request
and response shapes. Storage moves (M4): a briefing is an `ai_run` of kind
`briefing` with the briefing in `result` and no channel; today's briefing is
found by member, kind and club day. A summary run is kind `summary` pointing at
the thread it summarised.

---

## 5. Frontend

### 5.1 Routes

| Route           | Shows                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `/ai`           | A blank New chat. Nothing is saved until the first message.                                                                             |
| `/ai/:chatId`   | That chat. Linkable; survives a refresh.                                                                                                |
| `/ai/briefing`  | Today's briefing, with a composer that starts a chat about it (M14).                                                                    |
| `/ai?eventId=…` | A blank New chat tied to that event. The existing **Plan with AI** link on an event's Tasks tab (tier 1 and above) keeps pointing here. |

The navigation label stays **AI Breakdown**; the page heading stays
**AI Assistant**.

### 5.2 Layout (M12)

The same bordered two-column panel as `routes/messages.tsx`.

**Left — Chats.** A **New chat** button; then a pinned **Today's briefing**
entry, set apart from the chats below it and highlighted when open (M14); then
the member's chats, most recently
active first: title and last-activity time, the open one highlighted. Each row
has **Rename** and **Delete** icon buttons. Rename edits the title in place
(Enter saves, Escape cancels). Delete confirms in the existing `Dialog`. Below
`lg` the list becomes the horizontal strip Messages uses.

**Right — the open chat.**

- Header: the title; a chip linking to the chat's event, when it has one; a
  **Generated** toggle.
- Conversation log: member messages and assistant replies in today's bubbles,
  including the thinking indicator while a reply is on its way. Under a reply
  whose run has a plan: `open` → the live `ProposalCard`; `applied` →
  "Applied", with links to each task and event it made; `discarded` → a short
  "Discarded" note.
- Composer: Enter sends, Shift+Enter adds a line. A first message on a blank
  chat creates the chat and moves the address to `/ai/:chatId` without a reload.
- Assistant off (`AI_DISABLED`): the composer is replaced by the "switched off"
  notice. The chat list and old chats stay readable, renamable and deletable.

**Right — the briefing** (`/ai/briefing`). The summary and bullets, the time it
was prepared, and a composer labelled "Ask about this…". Sending creates a new
chat seeded with the briefing (§4.2) and moves to `/ai/:chatId`, where the
briefing is the first message on screen. While the briefing is loading the
panel says so; if it fails it shows the error with **Try again**. With the
assistant off (`AI_DISABLED`) the pinned entry is not shown at all.

**Generated toggle.** A button with `aria-expanded`, closed by default. Open, it
shows a panel listing everything the assistant has made across all chats: tasks
and events with an `aiRunId`, each linking to its page.

### 5.3 Hooks (ViewModel layer)

- `useAiChats()` — the list, `rename(chat, title)`, `remove(chat)`.
- `useAiChat(chatId | undefined, seed?)` — the open chat's messages, `send`,
  `apply`, `discard`, `pending`, `error`. Replaces `useAssistant`, which is
  deleted.

### 5.4 Elsewhere

- `routes/messages.tsx` loses its `ai` special cases (the "MAC Assistant" thread
  name); it can no longer receive one.
- `ThreadSummaryPanel` and `ProposalCard` are unchanged.

### 5.5 The briefing on the Overview page (M13)

`BriefingCard` moves out of the right rail to the **top of the Overview page**:
full width, directly under the page header and above the stat strip. It shows
the summary, the bullets, and an **Ask the assistant** button linking to
`/ai/briefing`.

It is no longer silently absent. Its states:

| State                              | Shows                                                            |
| ---------------------------------- | ---------------------------------------------------------------- |
| loading                            | The card, with "Preparing your briefing…" as a status.           |
| ready                              | Summary, bullets, the button.                                    |
| failed (including a busy provider) | "Couldn't prepare today's briefing." and a **Try again** button. |
| assistant off (`AI_DISABLED`)      | Nothing: the deployment has no assistant to brief anyone.        |

`useBriefing()` gains `retry()` for the button; both the Overview card and the
AI Breakdown panel use the same hook, so the two never disagree about today's
briefing.

---

## 6. Edge cases

| Situation                                                      | Behaviour                                                                                                                              |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A chat that is not the caller's, or no longer exists           | `404 CHAT_NOT_FOUND`. If it was open, the page says "This chat no longer exists" and returns to a blank New chat.                      |
| The model is busy, or returns unusable output                  | Nothing is saved to the chat. The text returns to the composer with the error shown. On a first message, no chat is created.           |
| Confirming a plan already applied or discarded                 | `409 PROPOSAL_CLOSED`; the card is replaced by the plan's real status.                                                                 |
| The chat's event is later hidden from the member, or cancelled | It silently stops being in view; the chat keeps working.                                                                               |
| Deleting the open chat                                         | The page returns to a blank New chat.                                                                                                  |
| A long chat                                                    | The model sees the most recent messages within the budget; older ones stay on screen but drop out of memory.                           |
| The briefing cannot be prepared                                | The Overview card and the AI Breakdown panel both show the failure with **Try again**; neither disappears.                             |
| A member's role is lowered                                     | Their old chats still hold what was said when they could see more — their own history. New replies use their current permissions (M3). |

The daily cap is unchanged: one run per message sent.

---

## 7. Testing

Same tiers as the rest of the repo. The provider is stubbed everywhere below; no
test calls the model.

- **Unit** — the title from a first message (collapse, cut, ellipsis); the
  conversation block built from history (order, labels, budget).
- **Integration** (real database):
  - chats are private: another member's chat is 404 on list, read, send, rename
    and delete;
  - a first message creates the chat, titled and seeded; a failed first turn
    creates nothing;
  - the second turn's prompt contains the first exchange, and never a handle
    from it;
  - the seed event stays in view across turns, and disappears from the prompt
    once the member can no longer see it;
  - a drafted plan reads back as `open`; apply makes it `applied` and a second
    apply is 409; discard makes it `discarded`; `applied` lists what was made;
  - deleting a chat removes its messages and keeps its runs, and the tasks it
    created keep their `ai_run_id`;
  - the threads API never lists an AI chat and 404s reading or posting to one;
  - the briefing is stored on and re-served from its run;
  - a chat started from the briefing opens with it as the first message, and
    that turn's prompt contains it;
  - the migration's data steps: old `ai` channels gone, runs kept with kinds set.
- **Frontend unit** — both hooks; the page: the list, New chat, rename, delete,
  reopening a chat with an open plan, an applied plan, the Generated toggle, the
  pinned briefing entry and asking about it; the Overview card's four states and
  its position above the stat strip.
- **E2E** (assistant endpoints stubbed in the browser, as now) — the chat list
  and card with axe scans in both themes; the Messages page showing no AI chat.

---

## 8. Order of work

1. Schema, shared schemas and migration `0011`.
2. Chat list, rename and delete endpoints.
3. `POST /api/ai/messages`: lazy creation, memory, the chat's event, saved plans;
   `GET /api/ai/chats/:id/messages`.
4. Apply and discard with plan status.
5. Threads API stops serving `ai` channels.
6. Briefing and summary runs move onto `ai_run`.
7. Frontend hooks.
8. The two-column chat page and routes.
9. The Generated panel; events gain `aiRunId`.
10. The briefing: the Overview card's new position and states, the pinned entry
    and `/ai/briefing`, the briefing seed.
11. E2E, API docs, PRD.

---

## 9. What this replaces in the earlier spec

- **D15** (the briefing is stored as a message) → M4.
- **§3.2** (the briefing as a card in the dashboard's right rail, rendering
  nothing on failure) → §5.5.
- **§3.1** (`/ai` as one conversation with a Generated-tasks rail) → §5.
- **§8.3** (each member gets exactly one `ai` channel, made on first use) → §3.
- `resolveAiChannel` and its advisory lock are removed; nothing needs a
  one-per-member channel any more.

---

## 10. Scope boundary

Not included: searching across chats; sharing a chat with another member;
replies appearing word by word; editing or regenerating a sent message;
archiving; keeping a card's unsaved edits when the member leaves the chat;
having the model name the chat.
