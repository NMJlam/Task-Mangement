# Database schema — design spec

**Date:** 2026-08-27
**Branch:** `gkur0003/database-schema`
**Status:** approved, not yet implemented
**Supersedes:** the standalone `schema.sql` design doc (written against a Next.js
stack; see "Corrections to the source document" below)

---

## 1. What this is

The full persistent model for the committee platform: **15 tables** covering
identity, teams, work, communication, money and notifications, for one committee
of roughly twenty people.

There is no tenant column anywhere, because there is exactly one committee.

This spec covers **schema, migration and constraint tests only**. The service
layer that enforces the cross-row rules in §8 is named here but implemented
separately.

---

## 2. Corrections to the source document

The source design doc was written against a different stack and contradicted
code already shipped in this repo. Every item below was reviewed and decided
before this spec was written.

| #   | Source doc said                                                     | Reality / decision                                                                                                                                                                        |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Next.js App Router, `lib/auth.ts`, `app/api/auth/[...all]/route.ts` | Express 4 + Vite SPA. The equivalents already exist: `backend/src/auth/auth.ts`, `backend/src/middleware/auth/authenticate.ts`, and `app.ts:24` mounts `/api/auth/*` via `toNodeHandler`. |
| 2   | Apply `schema.sql` with `psql -f`                                   | **Never.** This repo runs Drizzle. Raw SQL leaves the snapshot blind, and the next `db:generate` emits `DROP TABLE` for everything the SQL created. Author as Drizzle TS.                 |
| 3   | Role named `director`                                               | Repo had `marketing_director`. **`director` wins** — see §4.                                                                                                                              |
| 4   | No uniqueness on `invite.email`                                     | Repo shipped `invite_open_email_unique` in migration 0002. **The doc is right and the index is dropped** — see §6.1.                                                                      |
| 5   | `auth."user"` FK is `RESTRICT`                                      | Repo shipped `CASCADE`. **`RESTRICT` wins** — see §6.1.                                                                                                                                   |
| 6   | "No audit log — deliberately left out"                              | `audit_log` exists, is tagged `TODO(R12)`, and **survives**. The doc's "Deliberately left out" bullet is void.                                                                            |
| 7   | 14 tables                                                           | **15**, because `audit_log` stays.                                                                                                                                                        |
| 8   | Rule 12: reject in `user.create.before`                             | Repo claims membership lazily in `authenticate.ts:31-63`, already tested. **Shipped behaviour stands**; rule 12 is rewritten to describe it.                                              |
| 9   | "Adding a role edits one constraint"                                | Not true. It edits the `CHECK` **and** the `STORED` generated expression, which Postgres cannot `ALTER` and drizzle-kit diffs unreliably. See §7.3.                                       |

### Latent defects in the current database, fixed by this work

- `audit_log.actor_id` references nothing. Migration 0000 gave it an FK to
  `users`; migration 0001's `DROP TABLE "users" CASCADE` silently took the FK
  with it. Confirmed: `0002_snapshot.json` shows `public.audit_log` with an
  empty `foreignKeys` map.
- The `auth."user"` FK on `app_user` exists in the database but not in the
  snapshot — it was hand-patched into migration 0001, so it is invisible to
  every diff. Confirmed the same way.
- `teams`, `team_members`, `tasks`, `events` are tracked by drizzle-kit (it
  reads the schema _directory_) but are **not** exported from
  `schema/index.ts`, so `nodeDb()`'s query builder cannot type them.
- `public.task_status` is a native `pgEnum`, which the design explicitly rejects
  in favour of `text` + `CHECK`.

---

## 3. Decisions taken

1. **Enums are `text` + `CHECK`, never native Postgres types.**
2. **IDs are `uuid` with no `DEFAULT`.** The application generates UUIDv7 via
   `newId()` (`db/id.ts`). No `gen_random_uuid()` fallback — mixing v4 into a v7
   column destroys the index locality that motivated v7.
3. **All timestamps `timestamptz`. All money integer cents in `bigint`.**
   Single currency, implicitly AUD; no currency column.
4. **`tier` is a `STORED` generated column** derived from `role`.
5. **`app_user`, not `"user"`** — `user` is reserved and needs quoting forever.
6. **Authorization lives in the service layer, not RLS.**
7. **Derive, don't store.** Tier, invite status, overdue, unread counts, a
   director's portfolio — all computed.

### ON DELETE policy, stated once

- `SET NULL` on authored/owned references (author, creator,
  submitter, decider, lead, actor). A removed member leaves their work intact
  as "former member".
- `CASCADE` on pure junction rows (`team_member`, `task_assignee`, `chan_member`,
  `notification`). A membership row with no member is garbage, not history.
- `RESTRICT` on anything the ledger depends on (`expense → event`, `team`) and
  on `app_user → auth."user"`.

---

## 4. Vocabulary — `@ctp/shared`

CLAUDE.md rule 1: a domain type is defined in `shared/` exactly once. Every
`CHECK` list in §6 is **generated from these zod enums** using the
`SQL_ROLE_LIST` pattern already in `app-user.ts:5`, so the database and
`shared/` cannot drift.

```
role         president | vice_president | treasurer | secretary | director | officer
tier         0 officer | 1 director | 2 management        (derived from role)
taskStatus   todo | in_progress | blocked | done
taskPriority low | medium | high | urgent
eventStatus  planning | live | wrapped | cancelled
expenseStatus    pending | approved | paid | rejected
expenseCategory  catering | venue | marketing | equipment | transport | printing | other
channelKind      team | event | group | dm | ai
notificationKind task_assigned | task_due | mention | expense_decided
                 | invite_accepted | event_created
```

### The `director` rename

`marketing_director` → `director`, at **14 call sites across 8 files**,
including two frontend tests that are easy to miss:

```
shared/src/schemas/role/role.ts:8,23
shared/src/auth/capabilities.ts:5              invite:create grants
shared/src/auth/capabilities.test.ts:17,18
backend/src/routes/me/me.integration.test.ts:25,62
backend/src/routes/members/members.integration.test.ts:37,49,67
backend/src/routes/invites/invites.integration.test.ts:25,41
frontend/src/components/require-auth.test.tsx:16
frontend/src/components/role-change-confirmation.test.tsx:8
```

`seed.ts` needs no edit — it iterates `roleSchema.options`.

### Two hierarchies, kept apart

**Tier ranks people.** `officer` (0) → `director` (1) → `management` (2). The
only hierarchy in the system.

**Team groups work.** A flat list: Exec, Media, Marketing, Sponsorship, Events.
No parent, no rank, no authority over each other.

> Tier answers "what can I see". Role answers "what can I change".

Budget authority belongs to `treasurer` and `president` **by name**, not by
tier — otherwise a vice-president would inherit money powers purely for
outranking someone.

**A director's portfolio is derived, not stored.** "Marketing Director" means
the director who is `team.lead` of the Marketing team. There is no `portfolio`
column: encoding a portfolio in the role would fuse the two hierarchies this
design works hardest to keep apart. The roster resolves it with a join:

```sql
SELECT u.role, t.name AS portfolio
FROM app_user u LEFT JOIN team t ON t.lead = u.id
```

Known gaps, accepted: a director who leads no team has no portfolio label, and
two co-directors of one team cannot both be `lead`.

---

## 5. Table inventory

| #   | Table          | Change under the reset                                                                                         |
| --- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | `app_user`     | exists; FK to `auth."user"` becomes `RESTRICT`                                                                 |
| 2   | `team`         | renamed from `teams`; gains `lead`                                                                             |
| 3   | `team_member`  | renamed from `team_members`; drops unused `joined_at`                                                          |
| 4   | `invite`       | exists; gains `created_at` + not-both CHECK; loses unique index                                                |
| 5   | `event`        | renamed from `events`; loses `team_id`; gains status, allocation, min_tier, updated_at                         |
| 6   | `workstream`   | new                                                                                                            |
| 7   | `task`         | renamed from `tasks`; drops pgEnum; gains composite FK, priority, board_order, min_tier, updated_at, ai_run_id |
| 8   | `channel`      | new                                                                                                            |
| 9   | `chan_member`  | new                                                                                                            |
| 10  | `ai_run`       | new                                                                                                            |
| 11  | `message`      | new                                                                                                            |
| 12  | `expense`      | new; includes `description`                                                                                    |
| 13  | `settings`     | new; singleton row                                                                                             |
| 14  | `notification` | new; `kind` is CHECKed                                                                                         |
| 15  | `audit_log`    | exists; `actor_id` finally gets its FK                                                                         |

---

## 6. The tables

### 6.1 Identity

Better Auth owns identity in the `auth` schema (`user`, `session`, `account`,
`verification`), created by its own migrations. `app_user` is the **membership**
record — one row per committee member, pointing at an auth user.

That distinction is the entire authorization boundary. Anyone with a Google
account can complete the sign-in flow, so an auth user proves _identity_ and
never _membership_.

**`app_user`** — `id` uuid PK; `auth_user_id` text NOT NULL UNIQUE REFERENCES
`auth."user"(id)` **ON DELETE RESTRICT**; `role` text NOT NULL CHECK;
`tier` smallint NOT NULL GENERATED ALWAYS AS (CASE role …) STORED;
`created_at` timestamptz.

`RESTRICT` is what makes rules 7 and 15 enforceable rather than aspirational.
With `CASCADE`, one stray delete orphans a departing member's open tasks with no
handover.

No `name` or `email` column — they live in `auth."user"`, joined for the roster.
No `oauth_sub` — `auth.account` already stores the Google subject as
`(providerId, accountId)`.

No indexes beyond the unique constraint on `auth_user_id`, which already covers
the one hot lookup: session user id → member, on every request. At twenty rows
the planner sequentially scans anything else.

**`team`** — `id`; `name` NOT NULL UNIQUE CHECK non-empty; `lead` uuid
REFERENCES `app_user` ON DELETE SET NULL; `created_at`. A single column, not a
second role system — a lead's authority comes from their tier.

**`team_member`** — `(team_id, user_id)` composite PK, both CASCADE. Plus
`team_member_user_idx` on `(user_id)`: the PK serves team → members, this serves
member → teams, which the sidebar needs on every page load.

**`invite`** — `id`; `email` NOT NULL CHECK lowercase; `role` NOT NULL CHECK;
`expires_at` NOT NULL; `accepted_at`; `revoked_at`; `created_at`.

Status is **derived** from three facts, never stored: revoked, else accepted,
else expired if `expires_at` is past, else pending. A stored status column would
be a fourth fact and the only one capable of being wrong.

`CHECK (accepted_at IS NULL OR revoked_at IS NULL)`.

**No uniqueness on `email`.** An index predicate cannot contain `now()` —
`now()` is not immutable and index predicates must be — so "live" would have
meant "not accepted, not revoked", _including expired rows_, and re-inviting
anyone whose invite lapsed would fail on the constraint. That is not
hypothetical: it is why `seed.ts:44-50` revokes stale invites before inserting,
and why commit `53d93d8` is titled "fix(db): replace expired founder invites".
Duplicate live invites are harmless — `authenticate.ts:36-44` already picks a
single winner with `ORDER BY expires_at DESC LIMIT 1 FOR UPDATE`.

### 6.2 Work

**`event`** — `id`; `title` NOT NULL CHECK non-empty; `starts_at` NOT NULL;
`ends_at`; `status` NOT NULL DEFAULT `planning` CHECK; `allocation_cents`
bigint NOT NULL DEFAULT 0 CHECK >= 0; `min_tier` smallint NOT NULL DEFAULT 0
CHECK 0..2; `created_at`; `updated_at`.

`CHECK (ends_at IS NULL OR ends_at >= starts_at)`.

`allocation_cents` is this event's slice of `settings.budget_cents` — a
different number from the pool; conflating them is how overspend goes unnoticed.

`cancelled` is the soft delete and `status` alone carries it. No `deleted_at`:
`RESTRICT` on `expense.event_id` already makes a destructive delete impossible,
and a soft-delete flag that leaks from one query is worse than a hard delete.

No `creator` column — `audit_log` records who created it.

Index `event_starts_at_idx` on `(starts_at DESC)` for the calendar.

**`workstream`** — `id`; `event_id` NOT NULL CASCADE; `team_id` NOT NULL
RESTRICT; `brief` text; `lead` SET NULL; `due_at`; `created_at`;
UNIQUE `(event_id, team_id)`.

The `brief` column is what earned this table its promotion from a join table.
Everything else here is derivable from tasks; the brief is not. Without it,
"media is involved but hasn't planned anything" is invisible.

The unique constraint is required as the target of `task`'s composite FK, and is
correct in its own right: one deliverable per team per event.

**No `min_tier`.** A workstream is visible exactly when its event is — see rule 16. One fact, not two.

**`task`** — `id`; `event_id` CASCADE (nullable); `team_id` SET NULL (nullable);
`creator` SET NULL; `title` NOT NULL CHECK non-empty; `description`;
`status` NOT NULL DEFAULT `todo` CHECK; `priority` NOT NULL DEFAULT
`medium` CHECK; `due_at`; `board_order` integer NOT NULL DEFAULT 0;
`min_tier` smallint NOT NULL DEFAULT 0 CHECK 0..2; `completed_at`; `ai_run_id`
SET NULL; `created_at`; `updated_at`.

Both parents nullable: standing committee work belongs to no event,
cross-cutting work belongs to no team.

`creator` answers "who asked for this", and stays the human because the
assistant creates tasks on someone's behalf. "My work" is not a column here:
ownership lives in the `task_assignee` junction, so a task carries any number
of assignees, or none.

```
CHECK ((status = 'done') = (completed_at IS NOT NULL))
FOREIGN KEY (event_id, team_id) REFERENCES workstream (event_id, team_id)
    ON DELETE CASCADE
```

The composite FK stops a task landing in a workstream nobody declared.
`MATCH SIMPLE` is the SQL default, so a NULL in either column skips the check
entirely — which is what keeps standing and event-wide tasks legal.

`board_order` is an explicit integer because a Kanban board is draggable and
sorting by date is not. Renumber the affected column in one transaction per
move. A column is every card of one `status` — **across events** — because that
is the column a reader sees: `/tasks` shows one column made of every event's
cards, and scoping the renumber to the moved card's own event leaves a card
dropped between two other events' cards nowhere near where it was dropped on
the next read. Contiguous per `status`, with the standing board's cards sharing
the same sequence. If renumbering is outgrown, fractional ranking keys are the
upgrade.

Indexes: `task_board_idx (event_id, status, board_order)` for an event's board;
`task_status_board_idx (status, board_order)` for the renumber's own read;
`task_overdue_idx (due_at) WHERE status <> 'done' AND due_at IS NOT NULL`.

No assignee index here — the assignee set is not a column. "My open tasks" goes
through `task_assignee` by `user_id`: the partial `status <> 'done'` predicate
cannot move to the junction, because a junction index cannot reference
`task.status`.

Overdue is never a stored flag — a stored flag is wrong every midnight.

**`task_assignee`** — `(task_id, user_id)` composite PK, both CASCADE, and no
other column: assignment is an unordered set with no primary assignee. Plus
`task_assignee_user_idx` on `(user_id)`: the PK serves task → assignees, this
serves member → tasks, which "my tasks" reads on every load.

### 6.3 Communication

**`channel`** — `id`; `event_id` CASCADE; `team_id` CASCADE; `kind` NOT NULL
CHECK; `name`; `min_tier` NOT NULL DEFAULT 0 CHECK 0..2; `created_at`.

Two visibility mechanisms, and `kind` decides which applies:

| kind                | gate                                         |
| ------------------- | -------------------------------------------- |
| `team`, `event`     | `min_tier` — everyone at that tier or above  |
| `group`, `dm`, `ai` | membership — a `chan_member` row is required |

Mixing them makes both incoherent. A private management channel is a `group`;
"directors and up" is a `team` channel with `min_tier = 1`.

```
CHECK (CASE kind
    WHEN 'team'  THEN team_id  IS NOT NULL AND event_id IS NULL
    WHEN 'event' THEN event_id IS NOT NULL AND team_id  IS NULL
    ELSE              team_id  IS NULL     AND event_id IS NULL END)
CHECK (kind IN ('team','event') OR min_tier = 0)
CHECK (kind = 'dm' OR (name IS NOT NULL AND length(trim(name)) > 0))
```

The second constraint is what stops the two mechanisms bleeding into each
other: `min_tier` is meaningless on a membership-gated channel, so it may not be
set there.

`channel_one_per_team` UNIQUE on `(team_id) WHERE kind = 'team'`. Events are
deliberately not constrained — a big event plausibly wants separate logistics
and volunteers channels.

**`chan_member`** — `(channel_id, user_id)` PK, both CASCADE; `last_read_at`
timestamptz NOT NULL DEFAULT now(). Membership **and** read state in one row;
these are commonly two tables with an identical primary key, which means they
were one table wearing two hats.

`last_read_at` is a high-water mark, so unread is a count of messages in the
channel created after it — one row per person per channel, not one per message
read. NOT NULL matters: a NULL silently breaks that comparison for anyone who
has never opened the channel.

Index `chan_member_user_idx (user_id)`.

**`ai_run`** — `id`; `channel_id` NOT NULL CASCADE; `user_id` SET NULL;
`prompt` NOT NULL; `steps` jsonb NOT NULL DEFAULT empty array;
`cost_micro_usd` bigint NOT NULL DEFAULT 0 CHECK >= 0; `created_at`.

The AI acts **as** the requesting user: it calls the same service functions the
HTTP routes call, so it inherits their permissions and cannot exceed them. No
separate write path, no proposal-and-accept table.

`steps` is the tool trace — which tools ran, inputs, outputs, timings. JSON is
right because nothing is ever queried across runs.

**`message`** — `id`; `channel_id` NOT NULL CASCADE; `task_id` SET NULL;
`parent_id` self-ref SET NULL; `author` SET NULL; `body` NOT NULL DEFAULT empty;
`file_key`, `file_name`, `file_size_bytes`, `file_mime`; `ai_run_id` SET NULL;
`created_at`; `edited_at`.

A comment lives in a channel **and** points at a task, so it appears in both the
channel and the task drawer, inheriting mentions, threading, unread counts and
realtime for free. `SET NULL` on `task_id` so deleting a task doesn't punch
holes in the channel. `SET NULL` on `parent_id` because deleting a thread root
must not delete other people's replies.

Attachments are columns, not a table: one file per message, no join on the
hottest read path, no orphan cleanup. Storage keys, not URLs — sign on read.

Mentions are `@[user-id]` tokens in the body, resolved client-side against the
roster. Display names aren't unique and break on rename.

```
CHECK (body <> '' OR file_key IS NOT NULL)
CHECK (num_nulls(file_key, file_name, file_size_bytes, file_mime) IN (0, 4))
CHECK (parent_id IS NULL OR parent_id <> id)
CHECK (file_size_bytes IS NULL OR file_size_bytes > 0)
```

Indexes: `message_channel_idx (channel_id, created_at DESC)` — the hottest read
in the system; `message_task_idx (task_id, created_at) WHERE task_id IS NOT
NULL`; `message_parent_idx (parent_id) WHERE parent_id IS NOT NULL`.

### 6.4 Money

The whole domain is one table plus two columns: `settings.budget_cents` is the
pool, `event.allocation_cents` divides it, `expense` records what actually left.
The first two were one-to-one with rows that already existed, so they are
columns rather than tables.

**`expense`** — `id`; `event_id` **RESTRICT**; `team_id` **RESTRICT**;
`amount_cents` bigint NOT NULL CHECK > 0; `description` text NOT NULL CHECK
non-empty; `category` NOT NULL CHECK; `status` NOT NULL DEFAULT `pending`
CHECK; `submitter` SET NULL; `decider` SET NULL; `receipt_key`;
`rejection_reason`; `decided_at`; `paid_at`; `created_at`.

`RESTRICT` on both parents: deleting an event must never erase its ledger, and
`SET NULL` on `team_id` would quietly destroy spend-by-team for past periods.
Consequence, accepted: a team with recorded spend cannot be deleted. Rename it.

`description` is an addition to the source doc. Approving a bare amount and
category with no note is not a functional approval workflow.

```
CHECK ((status = 'rejected') = (rejection_reason IS NOT NULL))
CHECK (decider IS NULL OR decider <> submitter)
CHECK ((status = 'pending') = (decided_at IS NULL))
CHECK ((status = 'paid')    = (paid_at IS NOT NULL))
```

The separation-of-duty check is written as `decider <> submitter`, **not**
`decider IS DISTINCT FROM submitter`. The latter returns FALSE for two NULLs, a
CHECK is violated only by FALSE, and both columns go NULL when a member is
removed — so the obvious form would block member deletion.

Known and accepted: an `approved` row with a NULL `decider` is legal, so
"approved by a departed member" is indistinguishable from "approved by nobody".
This is the cost of `SET NULL`, taken deliberately.

No index on `event_id` or `team_id` — per-event ledgers and spend-by-team are
report queries over a few hundred rows a year. One partial index for the
treasurer's queue: `expense_pending_idx (created_at) WHERE status = 'pending'`.

**`settings`** — `id` smallint PK DEFAULT 1 CHECK `(id = 1)`; `budget_cents`
bigint NOT NULL DEFAULT 0 CHECK >= 0; `updated_at`. One row, pinned. Seeded
`ON CONFLICT DO NOTHING` so re-running migrations is safe. `updated_at` is
maintained by the service layer; there is no trigger.

### 6.5 Notifications and audit

**`notification`** — `id`; `user_id` NOT NULL **CASCADE**; `kind` NOT NULL
CHECK; `body` NOT NULL; `entity_type`; `entity_id`; `read_at`; `created_at`.

One row per recipient, fanned out at write time, so the read path is a single
indexed scan — a badge polled on every screen needs that. `body` is rendered
server-side in full, so the in-app feed and any email read identically.

The entity reference is `(type, id)` with **no** foreign key: it is a deep-link
target, and one table serves every entity type.

`CHECK (num_nulls(entity_type, entity_id) IN (0, 2))`.

`kind` is CHECKed rather than free text — it is the only vocabulary in the
schema that would otherwise be unconstrained, and a typo'd kind produces a
notification the UI cannot pick an icon or route for.

Indexes: `notification_feed_idx (user_id, created_at DESC)`;
`notification_unread_idx (user_id) WHERE read_at IS NULL`.

**`audit_log`** — retained for R12, contrary to the source doc. `id`;
`actor_id` uuid REFERENCES `app_user(id)` **ON DELETE SET NULL** — the FK it has
been missing since migration 0001; `action` NOT NULL; `entity_type` NOT NULL;
`entity_id`; `changes` jsonb; `created_at`.

Append-only. Backs the `/api/example/audit` fixture route, which is the repo's
documented worked example for the integration-test tier
(`docs/architecture.md:193`, `docs/contributing.md:172-186`). No index yet —
add `(entity_type, entity_id, created_at DESC)` only when a real read path needs
it.

---

## 7. Migration strategy — full reset

Safe because nothing outside local Docker Postgres holds data: no deployment in
use, no Neon branch in play.

### 7.1 Sequence

```bash
rm -rf backend/drizzle/            # 3 migrations + meta/ + _journal.json
# … write shared/ enums and the 15 schema files …
npm run db:generate                # ONE baseline migration
# … READ the generated SQL, hand-patch (§7.3) …
docker compose down -v             # -v is essential: drops the ctp-pgdata volume
docker compose up -d
npm run db:migrate                 # Better Auth migrations, then Drizzle
npm run db:seed
```

`docker compose down` without `-v` leaves the named volume intact, so the
baseline would be applied onto a database that still holds the old tables and
fail with "already exists".

Better Auth's tables are untouched by a Drizzle reset — `migrate.ts:19-23`
creates the `auth` schema and runs Better Auth's own migrations first. Dropping
the volume rebuilds them from scratch, in the right order.

**Teammates must run `docker compose down -v` and re-migrate after pulling.**

### 7.2 Drizzle configuration

```ts
// drizzle.config.ts
schemaFilter: ["public"];
```

Plus a read-only declaration of Better Auth's user table so the `app_user`
foreign key is finally tracked by the snapshot:

```ts
export const authSchema = pgSchema("auth");
export const authUser = authSchema.table("user", { id: text("id").primaryKey() });
```

`schemaFilter` is what stops drizzle-kit trying to _manage_ (create/drop) the
auth tables once they are declared. Together these resolve `plan.md`
watch-out #1 properly, replacing the hand-patched FK.

### 7.3 Read the generated SQL before applying

Not ceremony. drizzle-kit diffs `STORED` generated-column expressions
unreliably, and `tier` is one — its expression is built dynamically from
`roleSchema.options`. Verify by eye:

- the `tier` `CASE` arm reads `WHEN 'director' THEN 1` (not `marketing_director`)
- the `app_user` → `auth."user"` FK is present and `ON DELETE RESTRICT`
- no `CREATE TYPE … AS ENUM` survives (the `task_status` pgEnum must be gone)
- no `invite_open_email_unique`

A missed generated-column arm produces a live `director` row whose `CASE` falls
through to NULL and trips `NOT NULL` at insert time.

---

## 8. Rules the schema cannot hold

Each needs a named service function and a test. This list is as valuable as the
schema.

1. Total event allocation must not exceed the settings budget. Cross-row
   aggregate; needs `SELECT … FOR UPDATE` on the settings row, or two people
   allocating at once both pass and overspend.
2. Cancelling an event releases its unspent allocation.
3. Every assignee's tier >= `task.min_tier`. Refuse the **write** — an assignee
   must be able to see their own task.
4. `chan_member`'s tier >= `channel.min_tier`. Same shape.
5. `task.min_tier` >= its event's `min_tier`.
6. Committee keeps at least one president; a president cannot demote
   themselves. A partial unique index cannot say "at least one".
7. Open tasks reassigned before removing a member. Departure is the risky
   operation — there is no handover.
8. `board_order` stays contiguous per board. Renumber in one transaction.
9. Expense transitions guard on the status they leave: pending to decide,
   approved to settle.
10. Deleting a workstream is refused while it still has open tasks. The
    composite FK is `ON DELETE CASCADE`, so the database would otherwise
    silently take the tasks with it.
11. Message threads stay one level deep: reject a parent that itself has a
    parent.
12. **(rewritten)** First sign-in requires a live invite matching the auth
    user's address, and only when `emailVerified` is true. Enforced by the
    shipped lazy-claim in `authenticate.ts:31-63`: the auth user is allowed to
    exist, membership is claimed on the first authenticated request via a CTE
    that locks the newest live invite `FOR UPDATE`, inserts `app_user` and
    stamps `accepted_at`; no match is a 403 `NO_MEMBERSHIP`. Not a
    `user.create.before` hook — someone who signs in before being invited
    should work the moment the invite lands.
13. Do not expose money mutations as AI tools. Approving an expense is the one
    action where a hallucination costs real money.
14. Every request resolves the session user id to an `app_user` row, and a miss
    is a 403, not a 500. This is what makes a partially-provisioned account
    fail closed.
15. Removal order is fixed: reassign open tasks, delete `app_user`, then delete
    the auth user (cascading its sessions, revoking access immediately).
    `RESTRICT` on the FK enforces the middle step.
16. **(new)** A workstream is visible exactly when its event is. There is no
    separate gate and no `min_tier` column.

### Guarded updates are the pattern to internalise

```sql
UPDATE … SET status = <next> WHERE id = $1 AND status = <expected> RETURNING id;
```

Zero rows back means it already happened — return the current row, don't error.
Double-clicks become idempotent for free, and no idempotency-key table is needed.

---

## 9. Testing

Two tests worth applying to every table:

1. Name the query that reads it most often, and confirm an index serves it.
2. Try to delete a row, and trace what happens to everything referencing it.

Then **one integration test per `CHECK` constraint**, performing a deliberately
failing insert — roughly 30 tests. A constraint nobody has seen fire is a
constraint nobody trusts. These run in the `integration` CI job against Docker
Postgres.

Existing suites that must keep passing: `example.integration.test.ts`,
`me.integration.test.ts`, `members.integration.test.ts`,
`invites.integration.test.ts`, and the frontend component tests touched by the
`director` rename.

---

## 10. Out of scope

- Service-layer implementation of the 16 rules above.
- HTTP routes for the new tables.
- Frontend work beyond fixing the two tests broken by the `director` rename.
- Any AI tooling. `ai_run` is a table; the assistant is a channel of kind `ai` —
  a dedicated _page_, not a dedicated schema.
- No audit index until a read path demands one.
