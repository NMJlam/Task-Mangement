# Reorder Cards Within a Column — Implementation Plan

> **For agentic workers:** work this top to bottom, one task at a time. Each task
> ends with the command that proves it. The checkboxes are the progress record —
> tick them as you go, and do not start a phase before the one above is green.
> Keep every inline code span on one line: Prettier's Markdown printer is not
> idempotent when a span opens on one line and closes on the next, and
> `format:check` will fail on this file if that happens.

**Goal:** dragging a task card reorders it inside its column as well as moving it
between columns, and the new order survives a reload. The `board_order` column,
which the database schema already reserves for exactly this, becomes the stored
reading order of a column.

**Architecture:** one new shared pure rule (`insertAfter`), one extended endpoint
(`PATCH /api/tasks/:id/status` gains an optional `after` anchor), and the board
switches from raw draggables and droppables to sortables. The card's column is
still its status; only the slot becomes persisted state. Order is a
board-presentation concern, so the read endpoints keep their documented ordering
and the board sorts its columns client-side.

**Tech stack:** TypeScript (strict, no `any`), React 19, dnd-kit v0.5
(`useSortable`, `isSortable`, the optimistic sorting plugin, the accessibility
plugin), zod v4 via `@ctp/shared`, Drizzle and Postgres, Express, Vitest,
Playwright with axe.

**Spec:** `docs/prd.md` R3 (task board),
`docs/superpowers/specs/2026-08-27-database-schema-design.md` §8 (rule: renumber
the affected column in one transaction per move; contiguous per board),
`docs/api-endpoints.md` (Tasks), `docs/accessibility.md` (drag surfaces),
`CLAUDE.md` (shadcn-first, ViewModel layer, service layer, stub markers).

## Deviation, as built

The plan above stores a column as `(event_id, status)` and sorts the client's
columns by `board_order` (`board_order` was already scoped per `(event_id,
status)`), which reads correctly on a board that shows one event. Driving it in
a browser showed it is wrong on `/tasks`: that board shows **one column made of
every event's cards**, so a card dropped between two other events' cards lands
in its own event's column instead, and the next read puts it somewhere else
(the drop point and the reload disagreed in a real drag).

Decision 2's neighbour anchor is meaningful per board; the page a reader uses
is not per board. The fix, taken after measuring the above: **a column is every
card of one status, across events and the standing board together** — see
`reorderColumn` in `backend/src/routes/tasks/service.ts`, the schema comment in
`backend/src/db/schema/task.ts`, and
`docs/superpowers/specs/2026-08-27-database-schema-design.md` §8. Everything
else the plan specifies (the one shared `insertAfter`, the `after` anchor, the
renumber in one transaction, `completed_at` kept, sortables on the client,
optimistic commit in `onDragEnd`) stands as written. `task_status_board_idx
(status, board_order)` — migration `0009_silky_joystick` — serves the column
read the renumber and the client's sort both use.

## What is true today (evidence, not assumptions)

- `board_order` is an `integer NOT NULL DEFAULT 0`, indexed by
  `task_board_idx (event_id, status, board_order)`, and written by nothing but
  the seed (`backend/src/db/schema/task.ts:57`). Its own comment already names the
  rule to implement: renumber the affected column in one transaction per move,
  and a NULL `event_id` forms the single standing board.
- Only the event-embedded read orders by it: `GET /api/events/:id` sorts
  `asc(tasks.boardOrder)` (`backend/src/routes/events/events.ts:395`).
  `GET /api/tasks` is documented "newest first" (`docs/api-endpoints.md:224`) and
  the board renders whatever order it is handed.
- The board's drag is status-only. `TaskCard` uses `useDraggable`, each column is
  one `useDroppable`, and `handleDragEnd` resolves the drop through
  `statusOf(operation.target?.id)`. With sortable cards that target id becomes a
  task id, so the lookup returns `undefined` and the handler returns early: the
  move silently stops working. The announcements read the same id and would
  degrade to "Over the board."
- `changeStatus` in `frontend/src/hooks/use-tasks.ts` is the only caller of the
  status endpoint. The status picker in the card dialog is gone
  (`task-card.tsx` header comment; `task-detail-dialog.tsx:111` is a read-only
  badge), so the drag is the endpoint's only product caller.
- The optimistic sorting plugin is a default sortable plugin and does the whole
  drag-time visual job, including across groups: on dragover it re-parents the
  dragged element into the target group's DOM and reindexes both groups
  (`node_modules/@dnd-kit/dom/sortable.js:440-530`), and it reverts everything
  itself when a drag is cancelled. It needs a sortable target, so an empty column
  is invisible to it — which is why dropping on the column body stays a separate
  branch.

## Design decisions

1. **Extend `PATCH /api/tasks/:id/status`; do not add a second endpoint.** A
   status write and a slot write are one user action ("the card is now here"), and
   the endpoint already takes `{ status }`-shaped input. A parallel position route
   would duplicate the status extraction, the completion rule, the overdue-cycle
   reset and `assembleTasks` for no new capability.
2. **The client names a neighbour, not an index.** The body field `after` is the
   id of the card the moved card now follows, or `null` for the top of the column.
   An index means different things to a filtered board and to the server's whole
   column, so a `scope=mine` board would silently drop the card somewhere else; a
   neighbour is meaningful on both sides. Omitting `after` keeps the stored slot —
   today's pure status change, unchanged, so existing callers and tests keep
   working.
3. **Renumber the destination column 0..n-1; leave the source column alone.**
   Removing a card leaves a gap (`0,2,3`), and a gap reads identically because
   every reader orders by value. Renumbering the source too would be extra writes
   for no observable difference — the spec's "renumber the affected column" is
   singular for this reason.
4. **A reorder must not re-stamp `completed_at`.** The table enforces that status
   is `done` exactly when the timestamp is not null, so reordering the Done column
   re-writes the same status, and the current unconditional stamp would re-date
   finished work. The write becomes a `CASE` that keeps an existing stamp: moving
   into done stamps it, moving out clears it (the test at
   `tasks.integration.test.ts:612` still holds).
5. **Cards become sortables; the column droppable loses collisions.** Each card
   gets `useSortable` with `id`, `index` and `group` set to its status; the column
   keeps its droppable for empty columns and for the space under the last card,
   with `collisionPriority` set low so a card always wins over the column behind
   it (the pattern in dnd-kit's multiple-sortable-lists guide). `CollisionPriority`
   is exported by `@dnd-kit/abstract` alone — neither `@dnd-kit/dom` nor
   `@dnd-kit/react` re-exports it — so that package joins `frontend/package.json`
   as a declared dependency rather than being reached through hoisting.
6. **`onDragEnd` only; no `onDragOver` state sync.** The library optimistically
   moves the DOM during the drag and reverts on cancel, so the state update
   belongs at the end: dnd-kit's "multiple lists without the move helper" pattern,
   which is the documented shape for exactly this case. No new dependency for the
   splice — it is four lines and shared with the server.
7. **The board sorts each column by `board_order`, client-side.** `GET /api/tasks`
   keeps its documented "newest first"; `Array.prototype.sort` is stable, so a
   column nobody has reordered (every slot `0`, which is the column default)
   renders in exactly the order it does today. Changing that read's `ORDER BY`
   would reorder the dashboard list and the search results for no gain.
8. **The optimistic renumber keeps its own slot numbers when the response
   lands.** The stored `board_order` counts the whole column, while a filtered
   board (`scope=mine`, a status filter, an event's tier-limited Tasks tab) is a
   subset. Merging the server's number over a locally contiguous column can
   collide with a neighbour's number and shuffle cards under the pointer. The local
   board stays self-consistent and the next read brings the stored numbering.
9. **Reorder is tier 0**, exactly like the status move it replaces: the board's
   drag is already open to any member, and the renumber writes nothing a member
   could not write before.
10. **Announcements must not lie.** This component replaces the screen-reader
    sentences wholesale, so they must be rewritten for position — naming the
    column and where the card sits, never an id, and never a total the board
    cannot prove.

## Contracts

In `shared/src/schemas/task/task.ts`:

```ts
/**
 * `after` is where in the destination column the card lands: immediately after
 * that task, or at the top for `null`. Omitting it keeps the stored slot — the
 * pure status change this endpoint has always been.
 */
export const changeTaskStatusSchema = z.object({
  status: taskStatusSchema,
  after: storedTaskIdSchema.nullable().optional(),
});
```

In `shared/src/tasks/order.ts` (new, exported from `shared/src/index.ts`):

```ts
/**
 * The column's ids with `movedId` placed after `afterId` (`null` = first).
 * An anchor that is not in this column — a stale client — appends, which is the
 * same place as "after the last card", never a silent move to the top.
 */
export function insertAfter(
  ids: readonly string[],
  movedId: string,
  afterId: string | null,
): string[];
```

Endpoint semantics, each one a test:

- `after` omitted: status only, slot untouched (today's behaviour).
- `after: null`: first in the destination column.
- `after` naming a card in the destination column: immediately after it.
- `after` naming anything else: appended to the end.
- The response stays `200 { task }`, carrying `completedAt` and `assigneeIds` as
  it does now.

## Global constraints

- TypeScript `strict: true`, no `any`; domain shapes live only in `shared/`.
- `frontend/` never imports `backend/`; types cross only through `@ctp/shared`.
- A route gets data rules in its `service.ts` only. Keep that file framework-free
  (no `req`/`res`), take a transaction handle, and let the route map errors to
  status codes.
- `shared/` stays free of React, Express and db imports (the ESLint rule in
  §1.2). The one pure-function module here follows the precedent of
  `shared/src/auth/capabilities.ts`, so update the header comment in
  `shared/src/index.ts` to describe what the folder now holds.
- House copy: mutation failures append `. Try again.`; loading is a `role="status"`
  line; load errors are `role="alert"` and tell the reader to refresh.
- Colours are CSS variables only; `frontend/src/index.css` is not touched here.
- No shadcn or Radix component can make a card draggable, so the hand-rolled
  interactive parts stay: the grip button and the card-wide open button. Their
  keyboard path is the library's keyboard sensor, which this change keeps and
  re-announces.

---

## Phase 1 — The shared rule

### Task 1 — `insertAfter` and the widened status schema

- [x] `shared/src/tasks/order.ts`: `insertAfter` as specified above. Comment why
      the unknown-anchor fallback is append, and that this is the only place the
      renumber rule lives — the route and the board both call it, so they cannot
      drift.
- [x] `shared/src/tasks/order.test.ts`: head (`afterId` null), middle, last, anchor
      not present (appends), and `movedId` already in the list (no duplicate, no
      loss).
- [x] `shared/src/index.ts`: export the new module and adjust the folder's header
      comment to mention the shared pure rules.
- [x] `shared/src/schemas/task/task.ts`: add `after` to `changeTaskStatusSchema`,
      and replace the now-false note on `boardOrder` (that it keeps its column
      default "until the board endpoints land") with what it is: the stored slot
      within its column, written by the status endpoint.

**Verify:** `npm run build:packages && npm run test:unit --workspace @ctp/shared`

## Phase 2 — Backend

### Task 2 — `reorderColumn` in the tasks service

- [x] `backend/src/routes/tasks/service.ts`: add `reorderColumn`, taking a
      transaction, the moved row's `id`, `eventId` and `status`, and the anchor.
      It selects the column — status equal, plus `IS NOT DISTINCT FROM` on
      `event_id`, since a null event id is the standing board — ordered by
      `boardOrder`, then `createdAt` descending, then `id` ascending, runs those
      ids through `insertAfter`, and writes `boardOrder` equal to each position.
- [x] Mark the loop with a `ponytail:` comment naming both ceilings: one UPDATE per
      card in the column, inside the caller's transaction, fine to about a hundred
      rows (past that, an unnest-based single statement), and two moves in one
      column at the same moment being last-write-wins, which is why no row lock is
      taken at club scale.
- [x] Do not touch `updated_at` on the cards that merely shifted; only the moved
      row is a user-visible edit.

**Verify:** `npm run typecheck --workspace @ctp/backend`

### Task 3 — the endpoint

- [x] `backend/src/routes/tasks/tasks.ts`, the status route: read `status` and
      `after`; wrap the write in `db.transaction`; replace the `completedAt`
      spread with the case expression described in decision 4 (keep the existing
      helper for the create and patch routes, which always carry a real status);
      call `reorderColumn` only when `after` is not `undefined`; keep the
      `assembleTasks`-backed response and the `404`.
- [x] Extend the route's doc comment: the endpoint moves a card to a column and
      optionally to a slot, and a reorder is not a status change, so it must not
      re-stamp completion.

**Verify:** `docker compose up -d && npm run test:integration`

### Task 4 — integration coverage

- [x] `backend/src/routes/tasks/tasks.integration.test.ts`, in the existing status
      block. Seed three cards in one column of one event with slots `0,1,2`, then
      assert: 1. moving the last card to the top (`after` null) gives the new sequence
      when the column is read back in `asc(board_order)` order, and the ids are
      still contiguous from 0 — the renumber, not just the moved row's value; 2. a move after a named neighbour in the same column; 3. a move into another column after a named card of that column, with the
      source column's other cards keeping their slots (gaps are fine); 4. an anchor id that is not in the destination column appends; 5. omitting `after` leaves every slot alone (the backwards-compatible path); 6. reordering within Done leaves `completedAt` untouched, while `todo` to
      `done` still stamps it.
- [x] Use the suite's `seedTask(teamId, overrides)` helper to seed the slots, and
      assert on stored `board_order` read back directly, since that is the
      contract a later read sorts by.

**Verify:** `npm run test:integration`

### Task 5 — document the endpoint

- [x] `docs/api-endpoints.md`: the status row's input becomes either
      `{ "status": "done" }` or `{ "status": "todo", "after": "<task uuid>" }`, and
      a bullet joins "Things worth knowing": what `after` means, that null is the
      top, that an unknown anchor appends, that omitting it keeps the stored slot,
      and that the destination column is renumbered in one transaction while the
      source keeps its gaps.

**Verify:** `npx prettier --check docs/api-endpoints.md`

## Phase 3 — Frontend

### Task 6 — the board's order helpers

- [x] `frontend/src/lib/task-order.ts`: `byBoardOrder`, the stable sort key
      (comment that ties keep the server's newest-first order), and `reorder`,
      returning the next board: the destination column's ids, minus the moved
      card, in board order, through `insertAfter`; every returned id then carries
      its new `boardOrder`, and the moved card also carries the new status. Other
      columns are returned unchanged.
- [x] `frontend/src/lib/task-order.test.ts`: move to head, middle and tail of a
      column; a cross-column move that renumbers only the destination; an unknown
      anchor appends; cards in other columns come back untouched.

**Verify:** `npx vitest run frontend/src/lib/task-order.test.ts`

### Task 7 — the card is a sortable

- [x] `frontend/src/components/tasks/task-card.tsx`: replace `useDraggable` with
      `useSortable` from `@dnd-kit/react/sortable`, passing `id`, a new `index`
      prop, `group` equal to the task's status, the task type, the matching
      accept, `disabled`, and `data` carrying the title for the announcements.
      Keep the grip handle, the card-wide open button and both accessible names
      exactly as they are.
- [x] Update the file's header comment: the handle now moves a card within a
      column as well as between columns.

**Verify:** `npx vitest run frontend/src/components/tasks/task-board.test.tsx`

### Task 8 — the board wires it together

- [x] One computed layout drives both the render and the drop handler.
      `frontend/src/components/tasks/task-board.tsx` builds each column's cards
      already sorted with `byBoardOrder`, passes that array to `BoardColumn`, and
      `handleDragEnd` reads the same layout — so the order on screen and the order
      the handler reasons about cannot disagree.
- [x] The column droppable gains a low `collisionPriority` (imported from
      `@dnd-kit/abstract`); the per-card targets come from `useSortable`.
- [x] `handleDragEnd`: guard on `isSortable(source)` and a non-null target. A card
      target means the source already knows where it landed, through its group and
      index; a column target means the end of that column. Both then derive the
      slot, and the anchor is the id of the card one slot above it, or null at the
      top. Write nothing when `insertAfter` reproduces the column's current id
      order.
- [x] Rename the `onStatusChange` prop to `onMove`, taking the task, the status
      and the anchor.
- [x] Rewrite the three announcements to name the column and the position —
      pickup, hover and drop sentences carrying the column label and the position
      — keeping the cancelled and dropped-outside-a-column cases, and update the
      instructions to describe moving within a column.
- [x] `frontend/package.json`: add `@dnd-kit/abstract`, at the same `^0.5.0`
      range as the other dnd-kit packages.
- [x] `frontend/src/routes/tasks.tsx` and `frontend/src/routes/event-detail.tsx`:
      swap `onStatusChange` for `onMove`, calling the hook's move function with the
      status and the anchor.

**Verify:** `npm run typecheck --workspace @ctp/frontend`

### Task 9 — the ViewModel

- [x] `frontend/src/hooks/use-tasks.ts`: `changeStatus` becomes `moveTask`,
      taking the task, the status and the anchor. It updates optimistically through
      `reorder`, snapshots the previous items for the failure path (a reorder
      changes several rows, so restoring one card is not a revert), sends the
      anchor in the PATCH body, and on success merges the server's row over the
      board while keeping the local `boardOrder`, per decision 8. Doc-comment both
      halves: why the optimistic write, and why the stored slot is not taken from
      the response.

**Verify:** `npx vitest run frontend/src/routes/tasks.test.tsx`

### Task 10 — frontend tests

- [x] `frontend/src/components/tasks/task-board.test.tsx`: the dnd-kit mock grows
      a sortable mock — `useSortable`, and an `isSortable` that checks the fake's
      marker — and the existing drop helper builds a sortable operation (a fake
      source carrying index, initial index, group and initial group, plus a
      target). Cases: a card dropped on another card of the same column reports
      the anchor for the card above it; a card dropped on a column body asks for
      the end of that column; a cancelled drag, a drop outside any column, and a
      drop that reproduces the current order write nothing.
- [x] `frontend/src/routes/tasks.test.tsx`: give the drop helper the sortable
      shape, and assert the PATCH body carries both the status and the anchor,
      that the column is reordered optimistically (order within the column, not
      just the column), and that a failed write puts the whole column back.
- [x] Delete assertions that no longer describe the component — the column a card
      was dropped onto is no longer the only thing that changes.

**Verify:** `npm run test:unit`

### Task 11 — docs that already describe this surface

- [x] `docs/accessibility.md`: the drag-surface paragraph claims a task's status
      has a non-drag path through a picker in its dialog, and there is no such
      picker. Replace it with the truth: status and slot move together by drag, the
      keyboard sensor (Space, arrows, Space) is the non-pointer path, and the
      board's announcements name the column and the position.
- [x] `docs/prd.md` R3 as-built note: add column reorder — any card can be dragged
      to a slot in its own or another column, and the order is stored per board.

**Verify:** `npx prettier --check docs/accessibility.md docs/prd.md`

## Phase 4 — Verification

### Task 12 — the suite, and the drag paths by hand

- [x] `npm run verify` (Docker Postgres up, Playwright browsers installed). The
      axe scan of `/tasks` and of a seeded event page must stay green in both
      themes.
- [x] In a real browser, with the seeded demo data, drive and confirm: 1. mouse, same column: dragging a card by its grip into the middle of its
      own column leaves it where it was dropped, and a reload keeps the order; 2. mouse, other column: dropping a card onto a named card of another column
      puts it directly under that card, not at the end; 3. empty column: dropping into one works, since the column body is the only
      target there; 4. keyboard: focus a card's handle, press Space, move with the arrows within
      the column and into the next one, press Space, and read the live region to
      confirm the sentences name the column and the position; 5. failure: with the PATCH failing, the card returns to its old column and
      slot and the board says the update failed — a single-card revert would
      leave the column half-renumbered.
- [x] Record in the PR what was driven by hand. Drag has no automated pointer path
      in this repo: jsdom has no layout, and the end-to-end suite is axe-only.

## Ceilings, deliberately left

- **Concurrent moves in one column** are last-write-wins, marked with a `ponytail:`
  comment in the service. Two users reordering the same column within the same
  second can duplicate a neighbour's slot; the next read renumbers. A row lock or
  fractional keys are the upgrades, neither needed at club scale.
- **One UPDATE per card in the column**, inside the transaction. Fine to about a
  hundred cards; the unnest form is the one-statement upgrade.
- **Source-column gaps** are left in place: every reader orders by value, so they
  are invisible. If gaps ever matter, renumber both columns.
- **A tier-limited event Tasks tab** renumbers against the whole column while the
  reader sees only their tier's cards, so the visible slot is approximate. The
  global tasks read is not tier-filtered; only the event-embedded one is.
- **Tied slots** are ordered by the fetched order on the client and by the stored
  read on the server. The anchor makes this moot for the stored order; it can only
  affect which of two same-millisecond cards the local board shows first.

## Out of scope (named so nobody adds it "while we're at it")

A kanban/list toggle, work-in-progress limits, dragging between boards, dragging
from the dashboard, undo, realtime collaboration, subtasks, fractional ranking
keys, and any change to the calendar's drag. None are needed to reorder a card,
and each has its own requirement.
