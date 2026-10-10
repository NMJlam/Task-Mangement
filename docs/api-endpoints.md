# API endpoints

Every endpoint that exists today, with the inputs it accepts and the responses
it returns. Written to be read next to `/scratch` while testing by hand — see
[setup.md](setup.md#test-endpoints-by-hand-in-the-browser-dev-only) for getting a
session, and [roles-and-permissions.md](roles-and-permissions.md) for who is
allowed to call what.

Shapes come from the zod schemas in `shared/src/schemas/` — those are the source
of truth. If this page disagrees with them, this page is wrong.

## Conventions

- **Base URL:** `http://localhost:3001/api` directly, or `/api` through the Vite
  dev proxy on `:5173` (what `/scratch` uses).
- **Auth:** every route except `/api/health` and `/api/cron/*` needs the session
  cookie. No session is `401 UNAUTHENTICATED`; a signed-in account with no
  membership row is `403 NO_MEMBERSHIP`.
- **Tier n** in the tables below means tier n **or above**.
- **Validation failures** are always `422` in this shape:

  ```json
  {
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Request validation failed",
      "fields": { "name": ["Team name is required"] }
    }
  }
  ```

- **Every id is a UUID.** A malformed one fails validation (`422`), it does not
  `404`.
- **Dates** are ISO 8601 strings both ways, e.g. `"2026-10-01T09:00:00.000Z"`.
- **Enums:** role `president | vice_president | treasurer | secretary | director | officer`,
  task status `todo | in_progress | blocked | done`,
  task priority `low | medium | high | urgent`,
  event status `planning | live | wrapped | cancelled`,
  event risk `on_track | at_risk | critical`,
  expense status `pending | approved | paid | rejected`,
  expense category `catering | venue | marketing | equipment | transport | printing | other`,
  thread kind `team | event | group | dm | ai`.
- **Money is always integer cents**, never a float.

## Getting a session — `/api/auth/*` (Better Auth)

Password routes exist only when `DEV_PASSWORD_AUTH=1`.

| Endpoint                       | Body                        | Returns                           |
| ------------------------------ | --------------------------- | --------------------------------- |
| `POST /api/auth/sign-up/email` | `{ email, password, name }` | `200 { token, user }` + cookie    |
| `POST /api/auth/sign-in/email` | `{ email, password }`       | `200 { token, user }` + cookie    |
| `POST /api/auth/sign-out`      | —                           | `200`                             |
| `GET /api/auth/get-session`    | —                           | `200 { session, user }` or `null` |

Password must be at least 8 characters. Sign-up gives you an account but **not**
club membership — run `npm run db:dev-member -- <email> <role>` for that.

## Health

**`GET /api/health`** · public

```json
{ "ok": true, "commit": "abc1234" }
```

`commit` is the short git SHA, and is `""` locally.

## Me

**`GET /api/me`** · any member

```json
{ "user": { "id": "<uuid>", "email": "dev@example.com", "role": "president", "tier": 2 } }
```

`id` is the **membership** id (`app_user.id`), not the auth account id. This is
the id other endpoints want when they ask for a member.

## Members

### `GET /api/members` · tier 0

No inputs. Sorted by tier descending, then oldest first.

```json
{
  "members": [
    {
      "id": "<uuid>",
      "role": "director",
      "tier": 1,
      "createdAt": "2026-09-01T00:00:00.000Z",
      "name": "Marketing Lead",
      "email": "lead@example.com",
      "teamIds": ["<uuid>"],
      "portfolio": "Marketing"
    }
  ]
}
```

`name` and `email` are joined from `auth.user`; `portfolio` is the team this
member leads, or `null`.

### `PATCH /api/members/:id/role` · tier 1 + `member:role-change`

Body: `{ "role": "director" }`

| Response                                          | When                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `200 { "member": { id, role, tier, createdAt } }` | Changed. Setting the role it already has is a no-op `200`.        |
| `403 FORBIDDEN`                                   | "Role change exceeds your tier." or "Role cannot change members." |
| `404 MEMBER_NOT_FOUND`                            | No such member.                                                   |
| `409 ROLE_VACANCY`                                | Target is the last holder of a non-officer role.                  |
| `409 ROLE_CHANGED`                                | Someone else changed it first; re-read and retry.                 |

### `DELETE /api/members/:id` · tier 2

Query: `?reassignTo=<uuid>` — hands the departing member's unfinished tasks to
someone else. It is required when they hold any unfinished assignment, even one
on a task that still has other assignees; the successor takes their place on
those tasks, and an assignment the successor already holds is kept, not
duplicated.

| Response               | When                                                                |
| ---------------------- | ------------------------------------------------------------------- |
| `204`                  | Removed, with their auth account.                                   |
| `404 MEMBER_NOT_FOUND` | No such member.                                                     |
| `409 ROLE_VACANCY`     | Last holder of a non-officer role.                                  |
| `409 OPEN_TASKS`       | They are assigned an unfinished task and no `reassignTo` was given. |
| `422 VALIDATION_ERROR` | `reassignTo` is unknown, or is the departing member.                |

## Teams

### `GET /api/teams` · tier 0

Query: `?member=<uuid>` filters to teams that member belongs to. Sorted by name.

```json
{
  "teams": [
    {
      "id": "<uuid>",
      "name": "Marketing",
      "lead": "<uuid or null>",
      "createdAt": "2026-09-01T00:00:00.000Z",
      "memberIds": ["<uuid>"]
    }
  ]
}
```

There is no `GET /api/teams/:id` — the list carries everything.

### `POST /api/teams` · tier 2

Body: `{ "name": "Media", "lead": "<uuid>" }` — `lead` is optional and nullable,
and need not be a member of the team.

| Response                                 | When                                      |
| ---------------------------------------- | ----------------------------------------- |
| `201 { "team": { …, "memberIds": [] } }` | Created.                                  |
| `409 TEAM_NAME_TAKEN`                    | Name already exists.                      |
| `422 VALIDATION_ERROR`                   | Blank name, or `lead` is not a member id. |

Creating a team also opens its [thread](#threads), where comments on the team's
standing tasks land.

### `PATCH /api/teams/:id` · tier 2

Body: `{ "name": "Media" }`, `{ "lead": "<uuid>" }`, `{ "lead": null }` to clear,
or both. **At least one field** — `{}` is a `422`.

`200 { "team": … }` · `404 TEAM_NOT_FOUND` · `409 TEAM_NAME_TAKEN` · `422`

### `DELETE /api/teams/:id` · tier 2

`204` · `404 TEAM_NOT_FOUND` · `409 TEAM_IN_USE` (the team has workstreams or
recorded spend — rename it instead).

### `PUT` / `DELETE /api/teams/:teamId/members/:userId` · tier 1

Tier 1 may only staff a team they **lead**; tier 2 may staff any team. Both are
idempotent — adding twice or removing someone who was never on the team is still
`204`.

`204` · `403 FORBIDDEN` (not your team) · `404 TEAM_NOT_FOUND` ·
`422 VALIDATION_ERROR` (unknown `userId`, on `PUT`)

## Invites

### `POST /api/invites` · tier 1 + `invite:create`

```json
{ "email": "newcomer@example.com", "role": "officer", "expiresAt": "2026-10-01T00:00:00.000Z" }
```

`email` is lowercased for you. `expiresAt` must be in the future.

| Response                                                                                                 | When                                                              |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `201 { "invite": { id, email, role, expiresAt, acceptedAt: null, revokedAt: null, status: "pending" } }` | Created.                                                          |
| `403 FORBIDDEN`                                                                                          | "Invite role exceeds your tier." or "Role cannot create invites." |
| `422 VALIDATION_ERROR`                                                                                   | Bad email, unknown role, or a past `expiresAt`.                   |

The invited person becomes a member on their first signed-in request, as long as
their email is verified — see `authenticate.ts`.

## Tasks

A task object:

```json
{
  "id": "<uuid>",
  "eventId": null,
  "teamId": "<uuid or null>",
  "assigneeIds": ["<uuid>"],
  "creator": "<uuid or null>",
  "title": "Book the venue",
  "description": "<text or null>",
  "status": "todo",
  "priority": "medium",
  "dueAt": "2026-10-01T09:00:00.000Z",
  "boardOrder": 0,
  "minTier": 0,
  "completedAt": null,
  "aiRunId": null,
  "createdAt": "2026-09-16T00:00:00.000Z",
  "updatedAt": "2026-09-16T00:00:00.000Z"
}
```

| Endpoint                      | Who    | Input                                                                    | Success                                |
| ----------------------------- | ------ | ------------------------------------------------------------------------ | -------------------------------------- |
| `GET /api/tasks`              | tier 0 | `?eventId&teamId&status&priority&assignee&limit&offset`                  | `200 { tasks: [] }`, newest first      |
| `GET /api/tasks/overdue`      | tier 0 | `?eventId&teamId&assignee&limit&offset`                                  | `200 { tasks: [] }`, soonest due first |
| `GET /api/tasks/:id`          | tier 0 | —                                                                        | `200 { task }`                         |
| `POST /api/tasks`             | tier 0 | body below                                                               | `201 { task }`                         |
| `POST /api/tasks/bulk`        | tier 1 | `{ "tasks": [ … ] }`, 1–100                                              | `201 { tasks: [] }`                    |
| `PATCH /api/tasks/:id`        | tier 0 | any subset of the create body                                            | `200 { task }`                         |
| `PATCH /api/tasks/:id/status` | tier 0 | `{ "status": "done" }` or `{ "status": "todo", "after": "<task uuid>" }` | `200 { task }`                         |
| `DELETE /api/tasks/:id`       | tier 1 | —                                                                        | `204`                                  |

`limit` is 1–100 (default 50), `offset` defaults to 0. Both `422` if out of
range. `assignee` stays singular and filters by membership: it returns every
task whose `assigneeIds` contains that member, once each. Ties on `createdAt`
(a bulk insert shares one) and on `dueAt` break on `id`, so offset pages never
repeat or skip a task.

**Every task route hides what you can't see.** A task is visible when its own
`minTier` is at or below your tier, and so is its event's, if it has one
([rule 10](roles-and-permissions.md#rules)). Lists leave the rest out; reading,
editing, unlinking, moving, commenting on or deleting one answers
`404 TASK_NOT_FOUND`, the same as an unknown id.

Create body — only `title` is required:

```json
{
  "title": "Book the venue",
  "description": "<text>",
  "eventId": "<uuid>",
  "teamId": "<uuid>",
  "assigneeIds": ["<uuid>"],
  "status": "todo",
  "priority": "medium",
  "dueAt": "2026-10-01T09:00:00.000Z"
}
```

Things worth knowing before you test:

- **`creator` is stamped from your session.** Sending one in the body is ignored.
- **An unknown `eventId`, `teamId` or id in `assigneeIds` is a `422`**, with
  code `EVENT_NOT_FOUND`, `TEAM_NOT_FOUND` or `ASSIGNEE_NOT_FOUND` — not a
  `404`, because it's your input that's wrong. The first unknown member id
  fails the whole call, on create, bulk create and `PATCH`. A cancelled event,
  or one above your tier, is `EVENT_NOT_FOUND` too.
- **`assigneeIds` is the whole set.** Create defaults it to `[]`; `PATCH`
  replaces the set outright, `[]` clears every assignment, and omitting the
  field leaves it unchanged. Duplicate ids collapse to first-seen order, and a
  response never returns `null` — `[]` means unassigned.
- **It notifies** each member a create, bulk create, `PATCH` or applied AI plan
  newly puts on a task — never one already on it, never you — with a
  `task_assigned` notification, in the same transaction as the write. A member
  whose tier cannot see the task (its `minTier`, or its event's) gets none, so
  the notification never names a task hidden from them.
- **`description` is free text, up to 2000 characters.** It is trimmed, and an
  empty or all-whitespace value is stored as `null` — so "no description" has
  one representation, not two. Omitting it on `PATCH` leaves it alone; sending
  `""` or `null` clears it.
- **An event plus a team puts that team on the event.** A task naming both
  creates the team's workstream on the event if it has none — there is no
  separate call. The event then shows under `GET /api/events?teamId=`, and the
  team can no longer be deleted (`409 TEAM_IN_USE`). On `PATCH` the pair is your
  patch laid over the stored task, so changing only `teamId` is fine;
  `"eventId": null` unlinks.
- **`completedAt` is derived from `status`.** Moving to `done` stamps it; moving
  out clears it; a reorder inside `done` keeps the stamp it already had. You
  never send it.
- **`after` places the card within its new column.** It is the id of the card
  the moved one now follows; `null` means the top of the column, and an id that
  is not in the destination column (a stale client) appends rather than jumping
  to the top. Omitting `after` keeps the stored slot — the pure status change,
  unchanged. A column is every task of that status, whichever event it belongs
  to, and it is renumbered `0..n-1` in one transaction with the status write;
  the source column is left with a gap, which is invisible because every reader
  orders by the value. A reorder is not a status change, so it does not re-stamp
  `completedAt`.
- **`PATCH` needs at least one field**; `{}` is a `422`.
- **Bulk is all-or-nothing** — one bad reference writes nothing. Each task in
  `tasks` takes its own `assigneeIds`, and every link is written in the same
  transaction.
- **Overdue** means past `dueAt` and not `done`. Tasks with no due date never
  appear.
- A missing task is `404 TASK_NOT_FOUND` on every `/tasks/:id` route.
- **Comments and files** on a task are messages — see
  [`POST /api/tasks/:id/comments`](#post-apitasksidcomments-and-attachments--tier-0).

## Events

An event is the unit of club work: tasks, a channel, a team workstream and a
slice of the budget all hang off it. `cancelled` **is** the soft delete — there
is no `deleted_at`, and `DELETE /api/events/:id` is the only door into it.

An event object (`EventDetail` — `EventSummary` is this minus the last four
fields):

```json
{
  "id": "<uuid>",
  "title": "O-Week Booth",
  "status": "planning",
  "startsAt": "2026-10-01T09:00:00.000Z",
  "endsAt": null,
  "venue": "Campus Centre",
  "minTier": 0,
  "owner": { "id": "<uuid>", "name": "Ada" },
  "taskCounts": { "todo": 3, "inProgress": 1, "blocked": 0, "done": 2 },
  "overdueCount": 1,
  "budget": { "allocationCents": 50000, "committedCents": 12000, "spentCents": 0 },
  "description": null,
  "attendanceEstimate": 200,
  "createdAt": "2026-09-16T00:00:00.000Z",
  "updatedAt": "2026-09-16T00:00:00.000Z"
}
```

- **`taskCounts` has exactly four keys** and they total the event's tasks.
  `overdueCount` is a sibling, not a fifth key — an overdue task is _also_
  `todo`, `inProgress` or `blocked`, so folding it in would double-count.
- **`committedCents` is `approved` + `paid`; `spentCents` is `paid` only.** Burn
  rate is `committedCents / allocationCents`.
- **`minTier` hides, it doesn't forbid.** An event above your tier answers
  `404 EVENT_NOT_FOUND` on every route below — never `403`, which would confirm
  it exists.

| Endpoint                          | Who                                | Success          |
| --------------------------------- | ---------------------------------- | ---------------- |
| `GET /api/events`                 | tier 0                             | `200` page below |
| `GET /api/events/:id`             | tier 0                             | `200 { event }`  |
| `GET /api/events/:id/progress`    | tier 0                             | `200` progress   |
| `POST /api/events`                | tier 1                             | `201 { event }`  |
| `PATCH /api/events/:id`           | owner, or tier 1                   | `200 { event }`  |
| `PATCH /api/events/:id/status`    | tier 1                             | `200` status     |
| `DELETE /api/events/:id` (cancel) | president, or the Events-team lead | `204`            |

### `GET /api/events` · tier 0

Query: `?teamId&status&from&to&ownerId&limit&cursor`. `limit` is 1–100
(default **25**). Newest first (`startsAt DESC`).

```json
{ "items": [], "nextCursor": "MjAyNi0xMC0wMVQ...|<uuid>" }
```

- **`status` opts in.** Omit it and `cancelled` events are excluded; pass
  `?status=cancelled` and you get exactly those.
- **`cursor` is opaque** — base64 of `startsAt|id`, because `starts_at` isn't
  unique and a date-only cursor drops or repeats rows. Pass `nextCursor` back
  verbatim; a garbled one is `422 INVALID_CURSOR`, not a silent reset.
  `nextCursor` is `null` on the last page.
- `teamId` matches events the team has a **workstream** on.

### `GET /api/events/:id` · tier 0

Query: `?include=tasks,channel` — comma-separated. An unknown member is a `422`,
not a silent drop.

| Include    | Adds                                                        |
| ---------- | ----------------------------------------------------------- |
| `tasks`    | `tasks: []` — up to 50, board order, filtered by your tier  |
| `channel`  | `channelId` — omitted entirely if the event has no channel  |
| `expenses` | Accepted by the schema but **not implemented** — `TODO(R9)` |

`404 EVENT_NOT_FOUND` if it doesn't exist _or_ its `minTier` is above yours.

### `GET /api/events/:id/progress` · tier 0

No inputs.

```json
{
  "percentComplete": 33,
  "overdueCount": 1,
  "daysUntil": 15,
  "budgetBurn": 0.24,
  "risk": "at_risk",
  "riskReasons": ["1 overdue task"]
}
```

- `percentComplete` is `done / total` rounded. **`blocked` counts in the
  denominator, never the numerator.** No tasks at all reads `0`.
- `budgetBurn` is `committedCents / allocationCents`, or **`null`** when nothing
  is allocated — not `0`, which would read as "on budget".
- `daysUntil` is whole calendar days in `CLUB_TIMEZONE` (default
  `Australia/Melbourne`), not UTC — an evening event is off by one otherwise.
  Negative once the event has passed.
- `risk` is `critical` when over budget, or overdue work with ≤ 3 days left;
  `at_risk` when anything is overdue, or spend is running ahead of the planning
  runway; `on_track` otherwise. The rule lives in `computeProgress`
  (`routes/events/service.ts`) so every surface agrees.

### `POST /api/events` · tier 1

Only `title` and `startsAt` are required.

```json
{
  "title": "O-Week Booth",
  "description": "Recruitment stall",
  "venue": "Campus Centre",
  "startsAt": "2026-10-01T09:00:00.000Z",
  "endsAt": "2026-10-01T17:00:00.000Z",
  "attendanceEstimate": 200,
  "allocationCents": 50000,
  "minTier": 0,
  "teamId": "<uuid>"
}
```

Creates the event in `planning`, **stamps you as owner**, opens its event
channel, and — if `teamId` is given — its first workstream. All in one
transaction.

| Response               | When                                                               |
| ---------------------- | ------------------------------------------------------------------ |
| `201 { "event": … }`   | Created.                                                           |
| `403 FORBIDDEN`        | A non-zero `allocationCents` without `budget:manage`.              |
| `409 BUDGET_EXCEEDED`  | `allocationCents` would push club-wide allocation past the budget. |
| `422 TEAM_NOT_FOUND`   | Unknown `teamId`.                                                  |
| `422 VALIDATION_ERROR` | Blank title, or `endsAt` before `startsAt`.                        |

`teamId` seeds a workstream row (so does a task naming the event and a team), it
is not a column on the event — which is why `PATCH` drops it.

### `PATCH /api/events/:id` · owner, or tier 1

Body: any subset of the create body minus `teamId` and `status`. **At least one
field** — `{}` is a `422`.

```json
{ "event": {}, "warnings": ["2 tasks now fall after the event date"] }
```

| Response               | When                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `200 { "event": … }`   | Updated. `warnings` present only for the case below.                                       |
| `403 FORBIDDEN`        | Tier 0 and not the owner, or a **changed** `allocationCents` without `budget:manage`.      |
| `404 EVENT_NOT_FOUND`  | No such event, or above your tier — checked before anything else, the owner rule included. |
| `409 BUDGET_EXCEEDED`  | New `allocationCents` breaks the club budget.                                              |
| `422 VALIDATION_ERROR` | `endsAt` before `startsAt`, or the `minTier` rule below.                                   |

Because `warnings` matter to the person who moved the dates (they say how many
tasks now fall after the event), both reschedule surfaces show them: the event
page under its header, and the calendar preview inside its dialog. `warnings` is
omitted — not empty — on every other response.

`startsAt`/`endsAt` is the one PATCH the calendar issues. Dragging a chip sends
both ends shifted by the same number of whole local days (the time of day is
kept); the Edit-dates form sends the two instants the user picked, and moves the
end only when the start would otherwise overtake it.

- **Dates are validated merged, not per-body.** `PATCH { startsAt }` is checked
  against the event's _stored_ `endsAt`.
- **An unchanged allocation is not a change.** Sending the stored
  `allocationCents` back, as the edit form may, needs no capability.
- **The event's thread moves with it.** A new `title` or `minTier` is copied to
  the event's thread in the same transaction.
- **Moving a date notifies, it doesn't reschedule.** Tasks left due after the
  new date come back in `warnings`; every distinct assignee of the event's
  unfinished tasks gets an `event_date_changed` notification. The route never
  moves a due date for you.
- **Raising `minTier` is blocked** if it would hide the event from anyone
  already assigned a task on it — checked across every assignee of every task:
  `422`, field `minTier`.

### `PATCH /api/events/:id/status` · tier 1

Body: `{ "status": "live" }` — one of `planning | live | wrapped`. **Not
`cancelled`**; that is `DELETE`, because cancelling must also release budget.

Legal moves: `planning → live`, `live → wrapped`, `wrapped → live`, and
`cancelled → planning` (restore).

```json
{ "id": "<uuid>", "status": "wrapped", "blockers": [] }
```

| Response                              | When                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `200 { id, status, blockers: [] }`    | Moved. Setting the status it already has is a no-op `200`.                      |
| `409 { id, status, blockers: [ … ] }` | Wrapping with pending expenses — note this 409 is **not** the `ApiError` shape. |
| `409 INVALID_TRANSITION`              | Illegal hop, e.g. `planning → wrapped`.                                         |
| `404 EVENT_NOT_FOUND`                 | No such event, or above your tier — checked before the blockers are described.  |

### `DELETE /api/events/:id` · president, or the Events-team lead

Cancels — it does **not** delete. Sets `cancelled`, releases the unspent
allocation back to the pool (committed spend stays allocated), and notifies
every distinct assignee of the event's unfinished tasks.

| Response                        | When                                                            |
| ------------------------------- | --------------------------------------------------------------- |
| `204`                           | Cancelled. Cancelling an already-cancelled event is also `204`. |
| `403 FORBIDDEN`                 | Tier 1+ but neither the president nor the Events-team lead.     |
| `404 EVENT_NOT_FOUND`           | No such event, or above your tier.                              |
| `409 APPROVED_EXPENSES_PENDING` | Approved-but-unpaid expenses — pay or reject them first.        |

The Events-team exception is matched on `team.name = 'Events'` and requires the
event to have a workstream on that team. **Renaming the team silently removes
the exception.**

## Calendar

### `GET /api/calendar` · tier 0

Query: `?from&to` (**both required**), plus `?teamId` and
`?include=events,tasks` (default: both).

```json
{
  "items": [
    {
      "kind": "event",
      "id": "<uuid>",
      "title": "O-Week Booth",
      "startsAt": "2026-10-01T09:00:00.000Z",
      "endsAt": null,
      "status": "planning",
      "ownerId": "<uuid> | null"
    },
    {
      "kind": "task",
      "id": "<uuid>",
      "title": "Book the venue",
      "dueAt": "2026-09-28T09:00:00.000Z",
      "eventId": "<uuid>",
      "assigneeIds": ["<uuid>"]
    }
  ]
}
```

One list discriminated on `kind`, sorted by date across both types. **Events are
ranged by interval overlap** — `starts_at <= to AND COALESCE(ends_at, starts_at)

> = from`— so a multi-day event is returned by every window it occupies, not
only the one its start falls in. A NULL`ends_at`is a point event at`starts_at`. Tasks are still ranged on `dueAt`. Both are filtered by your tier,
> and cancelled events never appear.

- **`teamId` excludes standing tasks.** `task.team_id` is nullable — committee
  work belonging to no team can't match a team filter.
- **No clash detection.** Deliberately absent: "clash" has no agreed definition
  (same-day vs. interval overlap) and `endsAt` is nullable, so half the rows
  have no interval to overlap. There is no `clashes` field.

`/calendar` in the app sends `include=events`: the page is an events calendar
(day/week/month grid), so it never asks for the task union. The task branch and
its response shape stay for other consumers.

`ownerId` is on each event row so the page can decide whether to offer a move
without fetching the full detail first — the same owner-or-tier-1 rule
`PATCH /api/events/:id` enforces (see `lib/permissions.ts` on the frontend). The
grid's drag-to-reschedule and the preview's **Edit dates** both write through
that PATCH, so both are subject to it.

## Threads

A thread is a `channel` row, so the `channelId` that
`GET /api/events/:id?include=channel` returns is a thread id. Replying to a
message is a different thing — that's `parentId`, below.

Who sees a thread depends on its `kind`:

| Kind          | Opened by           | You see it when                                             |
| ------------- | ------------------- | ----------------------------------------------------------- |
| `team`        | `POST /api/teams`   | its `minTier` ≤ yours                                       |
| `event`       | `POST /api/events`  | its `minTier` ≤ yours **and** the event's `minTier` ≤ yours |
| `group`, `dm` | `POST /api/threads` | you're a member                                             |
| `ai`          | the assistant       | never — see below                                           |

A thread you can't see is `404 THREAD_NOT_FOUND` on every route below — never
`403`, which would confirm it exists.

**A cancelled event's thread is a read-only archive.** It follows the event,
which drops out of lists but is still served by its id. So the thread is left
out of `GET /api/threads`, but it can still be read, searched, marked read and
summarised. Posting to it, and commenting or attaching on that event's tasks, is
`409 THREAD_ARCHIVED`. The rule reads the event's status on every request, so
restoring the event (`cancelled → planning`) reopens the thread with its
history.

**A deleted group is gone for everyone in it.** `DELETE /api/threads/:id`
soft-deletes a custom group: it leaves every member's `GET /api/threads`, and
reading, posting to, marking read, deleting from or summarising it is `404
THREAD_NOT_FOUND` from then on. Its rows stay in the database, but no route
serves them; there is no restore.

**`ai` channels are never served here**, not even to their owner: they are
missing from the list, and reading, posting to or marking one read is `404
THREAD_NOT_FOUND`. They are assistant chats, read and written only through
[`/api/ai/chats`](#chats-apiaichats).

A thread object:

```json
{
  "id": "<uuid>",
  "kind": "group",
  "name": "Logistics",
  "teamId": null,
  "eventId": null,
  "minTier": 0,
  "createdAt": "2026-09-17T00:00:00.000Z",
  "createdBy": "<uuid>",
  "memberIds": ["<uuid>", "<uuid>"],
  "lastReadAt": "2026-09-17T09:00:00.000Z",
  "unreadCount": 2,
  "lastMessageAt": "2026-09-17T10:00:00.000Z"
}
```

- **`memberIds` is only filled on `group` and `dm` threads.** It is always
  `[]` on `team` and `event` threads, because `minTier` decides who is in them.
- **`unreadCount` counts messages after your `lastReadAt`, never your own.** On a
  team or event thread you've never marked read, `lastReadAt` is `null` and every
  message counts.
- **`name` is `null` only on a `dm`** — show the other member's name.
- **`createdBy` is who opened a `group`**, stamped from the session by
  `POST /api/threads`. It is `null` on every other kind, on a group opened
  before creators were recorded (they are not guessed), and once that member
  has left the club. Every creator, including officers, may delete their own
  group while they remain a member; presidents may also delete other groups
  they belong to.

A message object:

```json
{
  "id": "<uuid>",
  "channelId": "<thread uuid>",
  "taskId": null,
  "parentId": null,
  "author": "<uuid>",
  "body": "Venue is confirmed.",
  "fileKey": null,
  "fileName": null,
  "fileSizeBytes": null,
  "fileMime": null,
  "aiRunId": null,
  "createdAt": "2026-09-17T10:00:00.000Z",
  "editedAt": null,
  "deletedAt": null,
  "deletedBy": null
}
```

`author` is stamped from your session; names come from `GET /api/members`.

**A deleted message is a tombstone.** `deletedAt` is set and `body`, `fileKey`,
`fileName`, `fileSizeBytes` and `fileMime` are all empty; its id, `author`,
`createdAt`, `taskId` and `parentId` stay. It still appears in the thread's
history (show "Message deleted"), still works as a `before` cursor, and its
replies keep their `parentId`. `deletedBy` goes `null` if the member who
deleted it leaves the club; `deletedAt` stays.

| Endpoint                                      | Who                                                             | Input                    | Success                                          |
| --------------------------------------------- | --------------------------------------------------------------- | ------------------------ | ------------------------------------------------ |
| `GET /api/threads`                            | tier 0                                                          | `?kind`                  | `200 { threads: [] }`, latest activity first     |
| `POST /api/threads`                           | tier 0                                                          | body below               | `201 { thread }` — `200` for a dm that exists    |
| `GET /api/threads/:id/messages`               | tier 0                                                          | `?q&before&limit`        | `200 { messages: [], nextCursor }`, newest first |
| `POST /api/threads/:id/messages`              | tier 0                                                          | `{ "body", "parentId" }` | `201 { message }`                                |
| `POST /api/threads/:id/read`                  | tier 0                                                          | —                        | `200 { thread }`, with `unreadCount: 0`          |
| `DELETE /api/threads/:id/messages/:messageId` | author, or `message:delete-any`                                 | —                        | `200 { message }` — the tombstone                |
| `DELETE /api/threads/:id`                     | `group:delete-any`, or `group:delete-created` on your own group | —                        | `204`                                            |
| `POST /api/tasks/:id/comments`                | tier 0                                                          | `{ "body", "parentId" }` | `201 { message }`                                |
| `POST /api/tasks/:id/attachments`             | tier 0                                                          | body below               | `201 { message }`                                |

### `POST /api/threads` · tier 0

Starts a conversation. You're always a member, so leave yourself out.

```json
{ "kind": "dm", "memberId": "<uuid>" }
```

```json
{ "kind": "group", "name": "Logistics", "memberIds": ["<uuid>"] }
```

- **One dm per pair.** Starting one that already exists, from either side,
  returns it with `200`.
- **Only `group` and `dm`.** Any other `kind` is a `422`: team and event threads
  open with their team or event.
- `422 MEMBER_NOT_FOUND` for an unknown member id, and `422 VALIDATION_ERROR`
  for a dm with yourself.

### `GET /api/threads/:id/messages` · tier 0

`limit` is 1–100 (default 50).

- **Page back with `before`.** Pass the `nextCursor` you got — a message id —
  as `?before=`. It is `null` on the last page. A `before` that isn't a message
  in this thread is `422 INVALID_CURSOR`.
- **`q` searches message text**, case-insensitive. `%` and `_` match themselves.
  A deleted message never matches.
- **Deleted messages stay in the history**, as tombstones, so a page never has
  a hole where one was and a cursor on one still works.
- Replies come back in the same list; group them by `parentId`.

### `POST /api/threads/:id/messages` · tier 0

**Replies are one level deep.** `parentId` must be a message in this thread
that isn't itself a reply, or it's a `422` on field `parentId`. A deleted
message takes no new replies — also a `422` on `parentId` — though the replies
it already has stay.

**Posting waits for a group being deleted.** Every write into a thread takes the
thread's row lock first, so a post either lands before the group goes (and goes
with it) or finds it gone: `404 THREAD_NOT_FOUND`.

**@mentions.** Message bodies use `@[user-id]` tokens, which the composer
displays as names. In a **group or DM**, every mentioned ID must belong to that
conversation. A nonmember or unknown ID returns `422 VALIDATION_ERROR` on
`body`, with a generic membership message; the transaction saves neither the
message nor any notifications. Self-mentions remain valid and never notify;
repeated mentions create only one notification.

In team/event threads, recipients must meet the thread's visibility rules;
ineligible or unknown recipients are silently excluded from notifications.
Task comments use that same check against their task's thread. Ordinary names
and email addresses typed as text are not mention tokens.

### `DELETE /api/threads/:id/messages/:messageId` · author, or `message:delete-any`

Deletes one message for everyone, leaving its tombstone. Your own message, in a
thread you can see and write to, whatever your role and however old it is. The
president (`message:delete-any`) may also delete anyone else's, a former
member's included. A task comment is the same message, so it goes from the task
as well.

- `404 THREAD_NOT_FOUND` — the thread is hidden from you, deleted, or an `ai`
  chat. Checked first, so nothing is said about the message.
- `404 MESSAGE_NOT_FOUND` — no such message **in this thread**; an id from
  another thread is treated the same as none.
- `409 THREAD_ARCHIVED` — a cancelled event's thread is a read-only archive, for
  the president too.
- `403 FORBIDDEN` — someone else's message, and you lack `message:delete-any`.
- **Repeating it is safe.** Deleting a tombstone you may delete returns it again
  with `200`, and writes no second audit row.
- **What else it does**, in the same transaction: removes notifications aimed at
  this message (`entityType: "message"` — its mentions), and writes a
  `message.deleted` audit row recording who, which message and thread, and
  whether it was the `author` or a `moderator` — never the words. A task
  comment's `task_commented` notifications point at the task, carry no words,
  and stay.
- **Files:** the attachment fields are cleared. No file storage exists yet
  (`TODO(R11)`), so there is no stored object to remove; when there is, its
  cleanup belongs to that storage's lifecycle.

### `DELETE /api/threads/:id` · `group:delete-any`, or `group:delete-created`

Deletes a custom group for everyone in it. Answers `204` with no body.

| Caller                               | May delete                                   |
| ------------------------------------ | -------------------------------------------- |
| President (`group:delete-any`)       | any group they are a member of               |
| Director (`group:delete-created`)    | a group they opened (`createdBy`) and are in |
| Vice president, secretary, treasurer | a group they opened and are in               |
| Officer                              | a group they opened and are in               |
| Anyone not in the group              | no — it is `404`, whatever their role        |

- `404 THREAD_NOT_FOUND` — not a group you're in, already deleted, or an `ai`
  chat. Visibility is checked before anything else, so a president cannot find
  out a private group exists.
- `409 THREAD_DELETE_NOT_ALLOWED` — a `dm`, `team` or `event` thread you can
  see. A dm belongs to both people; team and event threads follow their team or
  event.
- `403 FORBIDDEN` — a group you're in that you may not delete.
- **It is a soft delete.** The group's `deleted_at` and `deleted_by` are set and
  its rows stay; every route then treats it as missing. Notifications aimed at
  its messages, or at the thread itself, are removed and a `group.deleted` audit
  row is written, in the same transaction.

### `POST /api/tasks/:id/comments` and `/attachments` · tier 0

A comment is a message with `taskId` set, posted in the task's thread, so it
shows up in the thread as well as belonging to the task.

- **Which thread:** the event's thread if the task has an `eventId`, otherwise
  its team's thread. A task on an event is always discussed in the event's
  thread, never its team's.
- **It notifies** every assignee of the task plus its creator — each once,
  never the author — with a `task_commented` notification.
- `409 NO_THREAD` — the task has no event and no team.
- `404 TASK_NOT_FOUND` — no such task, or its thread is hidden from you.

A comment takes the same body as a message, `parentId` included. An attachment
takes this — only the caption `body` is optional:

```json
{
  "fileKey": "tasks/<uuid>/run-sheet.pdf",
  "fileName": "run-sheet.pdf",
  "fileSizeBytes": 2048,
  "fileMime": "application/pdf",
  "body": "Run sheet v3"
}
```

**No file storage exists yet.** This records a file that has already been
uploaded under `fileKey`. It never receives the file itself, and reads return the
key, not a download link. `fileSizeBytes` must be between 1 byte and 25 MB.

## Budget and expenses

Money is club-wide. `settings.budget_cents` is the pool, event allocations
divide it, and expenses record committed (`approved` + `paid`) and spent
(`paid`) cents.

### `GET /api/budget` · tier 0

Returns the club totals, per-event totals (including events with zero
allocation), and committed/spent totals by category:

```json
{
  "budget": {
    "budgetCents": 1000000,
    "allocationCents": 250000,
    "committedCents": 120000,
    "spentCents": 80000,
    "availableCents": 750000,
    "risk": "on_track",
    "allocations": [
      {
        "eventId": "<uuid>",
        "eventTitle": "Hackathon",
        "allocationCents": 250000,
        "committedCents": 120000,
        "spentCents": 80000
      }
    ],
    "byCategory": [{ "category": "venue", "committedCents": 120000, "spentCents": 80000 }]
  }
}
```

Club risk is `critical` when committed spend exceeds the pool or an event is
over its allocation. Otherwise it reuses the event progress rule: `at_risk`
when an event's spend is ahead of its planning runway, and `on_track` otherwise.

The Finance page re-reads this and `GET /api/expenses` every 3 seconds (`VITE_FINANCE_POLL_MS`) while
its tab is visible (and on returning to it), so a payment or an allocation
change made elsewhere shows up without a reload. A refresh asks for as many
ledger rows as are already on screen, in pages of at most 100, so paging down
the ledger is not undone by it.

`allocations` lists only events at or below your tier. The totals, `risk` and
`byCategory` stay club-wide — a hidden event's allocation still counts against
the pool, so it never shows as available. The budget routes below and
`POST /api/expenses/:id/decision` return the summary filtered the same way.

### `PATCH /api/budget` · `budget:manage`

Body: `{ "budgetCents": 1000000 }`. Upserts the singleton settings row. Returns
the same shape as `GET /api/budget`; `409 BUDGET_EXCEEDED` if the new pool is
below existing active-event allocations.

### `PUT /api/budget/allocations/:eventId` · `budget:manage`

Body: `{ "allocationCents": 250000 }`. Uses the same locked allocation rule as
event updates and returns the refreshed budget. `404 EVENT_NOT_FOUND` for an
unknown event; `409 BUDGET_EXCEEDED` when the club pool would be exceeded.

### `GET /api/expenses` · tier 0

Query: `?eventId&teamId&status&limit=<1-100, default 25>&offset=<default 0>`.
President/treasurer see all rows. Other members see their own rows plus all
`approved` and `paid` rows, except any on an event above their tier — their
own included, and `total` counts the same rows. Returns `{ "expenses": [ … ], "total": 12 }`, newest
first. `createdAt` is the logged date. `receiptKey` remains a storage key until
file storage exists; it is not a public download URL.

### `POST /api/expenses` · `expense:approve`

```json
{
  "eventId": "<optional uuid>",
  "teamId": "<optional uuid>",
  "amountCents": 12500,
  "description": "Venue deposit",
  "category": "venue",
  "receiptKey": "<optional storage key>"
}
```

Always creates `pending`, stamps the caller as submitter, notifies the other
finance role holders, and returns `201 { "expense": { … } }`.

### `PATCH /api/expenses/:id` · `expense:approve`

Accepts a non-empty partial create body. Pending only; otherwise
`409 INVALID_EXPENSE_STATE`.

### `DELETE /api/expenses/:id` · `expense:approve`

Deletes a pending expense and returns `204`. Non-pending rows return
`409 INVALID_EXPENSE_STATE`.

### `POST /api/expenses/:id/decision` · `expense:approve`

Body is one of `{ "action": "approve" }`,
`{ "action": "reject", "reason": "…" }`, `{ "action": "mark_paid" }`, or
`{ "action": "unmark_paid" }`. Approve/reject leaves `pending`; mark-paid leaves
`approved`; unmark-paid leaves `paid`, returning the expense to `approved` and
clearing `paidAt` — it stays committed (still owed) but stops counting as spent,
and can be marked paid again. Returns `{ "expense": { … }, "budget": { … } }`
with refreshed budget context. A second or out-of-order decision is
`409 INVALID_EXPENSE_STATE`; approving/rejecting your own claim is
`422 OWN_EXPENSE` (marking paid or unpaid has no such rule — it is bookkeeping,
not a spending decision). The submitter is notified of a payment and of its
reversal.

## AI

Every endpoint that calls the model, or writes work, returns `503 AI_DISABLED`
unless `AI_ENABLED=1` and `GEMINI_API_KEY` are both set, which is **off by
default**. The chat endpoints and discard (marked ‡) call neither, so they answer
either way: a member can still read, rename and delete their chats on a
deployment with the assistant switched off. Request and response shapes are the
zod schemas in `shared/src/schemas/ai/ai.ts` — those are the source of truth,
and this page follows them. Design and the full tool inventory:
[`superpowers/specs/2026-09-23-ai-assistant-design.md`](superpowers/specs/2026-09-23-ai-assistant-design.md),
with chats as amended by
[`superpowers/specs/2026-09-30-ai-multi-chat-design.md`](superpowers/specs/2026-09-30-ai-multi-chat-design.md).

| Endpoint                                   | Who      | Input                                 | Success                                                                       |
| ------------------------------------------ | -------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| `POST /api/ai/messages`                    | tier 0   | `{ "chatId"?, "text": "…", "seed"? }` | `200 { chatId, runId, reply, proposal }`                                      |
| `POST /api/ai/proposals/apply`             | tier 0 † | `{ runId, operations, stats }`        | `201 { events: [{ id, title }], tasks: [{ id, title }] }`                     |
| `POST /api/ai/proposals/:runId/discard`    | tier 0 ‡ | —                                     | `204`                                                                         |
| `GET /api/ai/chats`                        | tier 0 ‡ | —                                     | `200 { chats: AiChat[] }`                                                     |
| `GET /api/ai/chats/:id/messages`           | tier 0 ‡ | —                                     | `200 { chat: AiChat, messages: AiChatMessage[] }`                             |
| `PATCH /api/ai/chats/:id`                  | tier 0 ‡ | `{ "title": "…" }` (1–80 characters)  | `200 { chat: AiChat }`                                                        |
| `DELETE /api/ai/chats/:id`                 | tier 0 ‡ | —                                     | `204`                                                                         |
| `POST /api/ai/threads/:id/summary`         | tier 0   | —                                     | `200 { summary: { summary, actionItems }, asOfMessageId, sourceFingerprint }` |
| `GET /api/ai/threads/:id/summary/validity` | tier 0 ‡ | `?asOf&fingerprint`                   | `200 { current: boolean }`                                                    |
| `GET /api/ai/briefing`                     | tier 0   | —                                     | `200 { briefing: { summary, bullets }, generatedAt }`                         |

† Tier 0 gets you in the door. **Each operation inside `operations` is gated
separately**, against the same check its equivalent route uses:

| Operation                | Mirrors                        | Gate             |
| ------------------------ | ------------------------------ | ---------------- |
| Create event             | `POST /api/events`             | tier 1           |
| Create one task          | `POST /api/tasks`              | tier 0           |
| Create two or more tasks | `POST /api/tasks/bulk`         | tier 1           |
| Update task              | `PATCH /api/tasks/:id`         | tier 0           |
| Update event             | `PATCH /api/events/:id`        | owner, or tier 1 |
| Update event status      | `PATCH /api/events/:id/status` | tier 1           |

### `POST /api/ai/messages`

Runs the model through up to eight tool steps as the caller, then answers. The
member's message and the reply are both appended to the chat — the reply stamped
with `ai_run_id` — and `chatId` says which chat that was. **This call writes no
tasks and no events.**

- **Without `chatId` it starts a chat**, but only once the turn succeeds: the
  chat, its title (the first message, cut to 60 characters) and both messages
  are written together, so a first message that fails leaves nothing behind.
- **With `chatId` it continues one** of the caller's own chats; any other id is
  `404 CHAT_NOT_FOUND`, checked before the daily cap is spent.
- **The assistant remembers the chat.** Its newest 40 messages, trimmed from the
  oldest end to 6,000 characters, go to the model ahead of the new one. Only
  words travel: the short handles a previous turn's tools issued (`T1`, `E2`)
  are not carried over, so the model re-reads anything it needs to act on.

`proposal` is `null` when the turn staged nothing. Otherwise it is the
**resolved** card (`aiResolvedProposalSchema`): every handle the model used has
already become an id, a task's `dueOffsetDays` has become an absolute `dueAt`
(23:59 club time on that day, computed in `CLUB_TIMEZONE`), assignees are
`{ id, name }` pairs, and each update carries the row's current `title` and a
`diffs` list of `{ field, before, after }` — plus `assigneeIds` when it moves
assignees. Handles never reach the client.

`seed` is optional starting context from whichever surface opened the chat, and
is honoured only when the message starts one:

- `{ "eventId": "<uuid>" }` from an event's "Plan with AI" button. The chat
  keeps it as `seedEventId`, and every later turn in that chat pre-loads the
  event again.
- `{ "briefing": true }` from today's briefing. The new chat opens with the
  briefing as its first message, so "what should I do first?" has something to
  refer to.

A seed only pre-loads what the assistant reads first; it grants no access the
caller does not already have, and a seed naming something they cannot see is
ignored.

`proposal` is also kept on the run that drafted it, with a status — `open`,
then `applied` or `discarded` — so a plan survives a reload and shows where it
stands when the chat is read back.

### `POST /api/ai/proposals/apply`

The payload is the card **as the member edited it**:

```json
{
  "runId": "<uuid>",
  "operations": [
    {
      "op": "create",
      "entity": "event",
      "ref": "$event1",
      "data": { "title": "Hackathon 2026", "startsAt": "2026-11-20T08:00:00.000Z" }
    },
    {
      "op": "create",
      "entity": "task",
      "data": {
        "title": "Book venue",
        "priority": "high",
        "assigneeIds": [],
        "eventRef": "$event1"
      }
    },
    { "op": "update", "entity": "task", "id": "<uuid>", "data": { "assigneeIds": ["<uuid>"] } }
  ],
  "stats": { "proposed": 9, "kept": 7, "edited": 2 }
}
```

| Status | Code                                     | When                                                         |
| ------ | ---------------------------------------- | ------------------------------------------------------------ |
| 403    | `FORBIDDEN`                              | an operation's gate (table above) refuses the caller         |
| 404    | `RUN_NOT_FOUND`                          | `runId` is not a run the caller made                         |
| 404    | `TASK_NOT_FOUND` / `EVENT_NOT_FOUND`     | an update names a row that does not exist                    |
| 409    | `PROPOSAL_CLOSED`                        | the run has no open plan — already applied or discarded      |
| 409    | `INVALID_TRANSITION` / `WRAP_BLOCKED`    | an event status change the status route would refuse         |
| 422    | `EVENT_NOT_FOUND` / `ASSIGNEE_NOT_FOUND` | a task names an event the caller cannot see, or a non-member |
| 422    | `VALIDATION_ERROR`                       | an event would end before it starts                          |

A plan applies **once**. The first apply claims it (`open` → `applied`) in the
same transaction that writes the work, so two clicks, two tabs or a retry after
a lost response get exactly one set of rows; the loser is `409
PROPOSAL_CLOSED`. A refusal rolls the claim back with everything else, leaving
the plan open to edit and try again.

### `POST /api/ai/proposals/:runId/discard`

Marks the run's open plan `discarded` and returns `204`. Writes no work. `404
RUN_NOT_FOUND` for someone else's run, `409 PROPOSAL_CLOSED` for a plan that is
already applied or discarded.

### Chats: `/api/ai/chats`

A chat is a channel of kind `ai` whose only member is its owner. **Only the
owner ever sees it**: another member's chat id is `404 CHAT_NOT_FOUND`, never
`403`, and the threads API (`/api/threads`) never serves an `ai` channel — not
in a list, not by id, not to post in — so assistant chats do not appear in
Messages.

```ts
type AiChat = {
  id: string;
  title: string;
  seedEventId: string | null; // the event it was opened from, if any
  lastMessageAt: string; // the list is newest first by this
  createdAt: string;
};

type AiChatMessage = {
  id: string;
  role: "member" | "assistant";
  body: string;
  createdAt: string;
  runId: string | null; // assistant replies only
  proposal: AiResolvedProposal | null; // the plan that reply drafted
  proposalStatus: "open" | "applied" | "discarded" | null;
  applied: {
    // what an applied plan made, read back from ai_run_id
    events: { id: string; title: string }[];
    tasks: { id: string; title: string; eventId: string | null }[];
  } | null;
};
```

`applied` lists only the rows the caller can still see. `DELETE` removes the
chat and its messages; the work its plans created stays, and so do its runs —
they still count towards the daily cap.

### `POST /api/ai/threads/:id/summary`

`:id` is a channel id. Summarises the newest 100 messages, trimmed from the
oldest end to a character budget. Deleted messages are never read. `403
FORBIDDEN` on a channel the caller cannot read (the threads route's own
visibility rule, checked on every request before any cache), `409 THREAD_EMPTY`
on a thread with no messages. A repeat for an unchanged thread is served from an
in-process cache — a local convenience; on Vercel the daily cap is what guards
the quota.

- **The cache is keyed on what the summary reads**, `sourceFingerprint`: the
  ids, authors and words of the exact messages kept, @mentions as names. Deleting
  any of them — not only the newest — changes it, so a summary of words that are
  gone is never served.
- **`409 THREAD_CHANGED`** — a message the model was reading was deleted, or the
  thread went, while it wrote. The summary is neither cached nor returned; ask
  again.

### `GET /api/ai/threads/:id/summary/validity`

Whether a summary on screen still describes its thread. Pass back its
`asOfMessageId` as `asOf` and its `sourceFingerprint` as `fingerprint`. Calls no
model, needs no quota and answers with the assistant switched off, so a page
can ask on every poll. Messages posted after `asOf` do not make it stale — it is
a summary as of then — but deleting one it was written from does: `{ "current":
false }`. `403 FORBIDDEN` on a channel the caller cannot read.

### `GET /api/ai/briefing`

Today's briefing for the caller, one per club day: generated from what their
dashboard already shows, read through the assistant's own tools (so it sees only
what they can), then stored on its own `ai_run` (`kind: "briefing"`) — in no
chat — and re-served from there. A page refresh is not a model call, and a
second visit reports the same `generatedAt`. Asking about it starts a chat (the
`{ "briefing": true }` seed above).

### Things worth knowing before you test

- **The model never emits a UUID.** Read tools issue short per-run handles
  (`T1`, `E2`) and the server resolves them. A tool the model aims at a handle
  this run never issued, or at a thread the caller cannot read, gets a refusal
  back as its result and the assistant says so; a bad handle left in the final
  proposal is `422 AI_OUTPUT_INVALID`.
- **Apply is all-or-nothing.** Every operation runs in one transaction, in
  dependency order — a staged event is created before the tasks that name it
  by `ref`, and the real id is substituted in. One refusal writes nothing.
- **Rows created or changed carry `ai_run_id`**, and `stats` lands on that run
  as `proposed_count` / `kept_count` / `edited_count` — evaluation data, never
  acted on. The client computes it because only it knows what was unchecked or
  edited.
- **Proposals can only create and update.** There is no tool for deleting,
  cancelling an event, changing a role, creating an invite, or touching
  `expense` / `budget` / `event.allocation_cents` — so none of those can appear
  in `operations`.
- **A busy provider** is `503 AI_UNAVAILABLE`, after two quick retries — same
  status as `AI_DISABLED`, different code: the assistant is on, so clients keep
  the composer and show the message instead of the "switched off" state.
- **Quota** is `AI_DAILY_RUN_CAP` `ai_run` rows per user per rolling 24h;
  exceeding it, or a provider 429, is `429 AI_QUOTA_EXCEEDED`.
- **Unparseable model output** is `422 AI_OUTPUT_INVALID` after one retry, as
  is a turn that runs out of tool steps — never a partial write.

## Notifications

Always scoped to the caller — there is no `userId` filter or admin view.

### `GET /api/notifications` · tier 0

Query: `?unreadOnly=<bool>&limit=<1-100, default 50>&offset=<default 0>`

```json
{
  "notifications": [
    {
      "id": "<uuid>",
      "userId": "<uuid>",
      "kind": "event_date_changed",
      "body": "Founders' Day moved to Oct 12.",
      "entityType": "event",
      "entityId": "<uuid>",
      "readAt": null,
      "createdAt": "2026-09-01T00:00:00.000Z"
    }
  ],
  "unreadCount": 3
}
```

Newest first. `entityType`/`entityId` are a deep-link target (no lookup), and
travel together or not at all.

### `PATCH /api/notifications/:id/read` · tier 0

No body. Idempotent — marking an already-read notification as read is a no-op
`200`, not an error.

| Response                      | When                                     |
| ----------------------------- | ---------------------------------------- |
| `200 { "notification": {…} }` | Marked read (or already was).            |
| `404 NOTIFICATION_NOT_FOUND`  | No such notification, or it isn't yours. |

### `PATCH /api/notifications/read-all` · tier 0

No body. Marks every unread notification belonging to the caller as read.

```json
{ "count": 3 }
```

## Cron

`GET /api/cron/warm` → `{ "ok": true }` (still a stub; not scheduled on Hobby —
RR6).

`GET /api/cron/reminders` → `{ "ok": true, "escalated": 1, "sent": 0 }`,
scheduled daily at 09:00 UTC in `vercel.json`. It escalates overdue work in ONE
set-based statement: rows with `due_at < now()`, `status <> 'done'` and
`overdue_escalated_at IS NULL` become `priority = 'urgent'`, and the marker is
stamped with the sweep time. `escalated` is the number of rows the statement
touched; `sent` is reserved for a notification fan-out that does not exist yet.

The marker is what makes this **once per overdue cycle** rather than every
night, so a user's post-escalation priority change survives the next sweep. It
is cleared — starting a new cycle — only when the deadline moves
(`PATCH /api/tasks/:id` with `dueAt`) or a completed task is reopened
(`PATCH /api/tasks/:id/status` from a stored `done`). A priority-only edit and an
open-to-open status move leave it alone. `overdue_escalated_at` is backend
operational state and never appears in a task response; "overdue" as a
read-time count stays `status <> 'done' AND due_at < now()`.

Neither route takes a session — they need `Authorization: Bearer <CRON_SECRET>`,
and answer `401 UNAUTHORISED` otherwise. `CRON_SECRET` is empty by default
locally, which makes **every** call `401` until you set one.

## Fixture routes

Reference endpoints for the testing tiers, not features. Both are tier 0.

- **`POST /api/example`** — body `{ "name": "Ada", "email": "ada@example.com" }`
  → `200 { "ok": true, "received": { … } }`. Proves one schema validating on
  both sides.
- **`POST /api/example/audit`** — body
  `{ "action": "task.updated", "entityType": "task", "entityId": "<uuid>" }`
  (`entityId` optional) → `201 { "ok": true, "entry": { … } }`. Writes one
  `audit_log` row.
