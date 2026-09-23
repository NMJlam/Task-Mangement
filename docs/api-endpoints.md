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

| Endpoint                      | Who    | Input                                                   | Success                                |
| ----------------------------- | ------ | ------------------------------------------------------- | -------------------------------------- |
| `GET /api/tasks`              | tier 0 | `?eventId&teamId&status&priority&assignee&limit&offset` | `200 { tasks: [] }`, newest first      |
| `GET /api/tasks/overdue`      | tier 0 | `?eventId&teamId&assignee&limit&offset`                 | `200 { tasks: [] }`, soonest due first |
| `GET /api/tasks/:id`          | tier 0 | —                                                       | `200 { task }`                         |
| `POST /api/tasks`             | tier 0 | body below                                              | `201 { task }`                         |
| `POST /api/tasks/bulk`        | tier 1 | `{ "tasks": [ … ] }`, 1–100                             | `201 { tasks: [] }`                    |
| `PATCH /api/tasks/:id`        | tier 0 | any subset of the create body                           | `200 { task }`                         |
| `PATCH /api/tasks/:id/status` | tier 0 | `{ "status": "done" }`                                  | `200 { task }`                         |
| `DELETE /api/tasks/:id`       | tier 1 | —                                                       | `204`                                  |

`limit` is 1–100 (default 50), `offset` defaults to 0. Both `422` if out of
range. `assignee` stays singular and filters by membership: it returns every
task whose `assigneeIds` contains that member, once each.

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
  out clears it. You never send it.
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

| Response             | When                                                 |
| -------------------- | ---------------------------------------------------- |
| `200 { "event": … }` | Updated. `warnings` present only for the case below. |

Because `warnings` matter to the person who moved the dates (they say how many
tasks now fall after the event), both reschedule surfaces show them: the event
page under its header, and the calendar preview inside its dialog. `warnings` is
omitted — not empty — on every other response.

`startsAt`/`endsAt` is the one PATCH the calendar issues. Dragging a chip sends
both ends shifted by the same number of whole local days (the time of day is
kept); the Edit-dates form sends the two instants the user picked, and moves the
end only when the start would otherwise overtake it.
| `403 FORBIDDEN` | Tier 0 and not the owner. |
| `404 EVENT_NOT_FOUND` | No such event, or above your tier. |
| `409 BUDGET_EXCEEDED` | New `allocationCents` breaks the club budget. |
| `422 VALIDATION_ERROR` | `endsAt` before `startsAt`, or the `minTier` rule below. |

- **Dates are validated merged, not per-body.** `PATCH { startsAt }` is checked
  against the event's _stored_ `endsAt`.
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
| `404 EVENT_NOT_FOUND`                 | No such event.                                                                  |

### `DELETE /api/events/:id` · president, or the Events-team lead

Cancels — it does **not** delete. Sets `cancelled`, releases the unspent
allocation back to the pool (committed spend stays allocated), and notifies
every distinct assignee of the event's unfinished tasks.

| Response                        | When                                                            |
| ------------------------------- | --------------------------------------------------------------- |
| `204`                           | Cancelled. Cancelling an already-cancelled event is also `204`. |
| `403 FORBIDDEN`                 | Tier 1+ but neither the president nor the Events-team lead.     |
| `404 EVENT_NOT_FOUND`           | No such event.                                                  |
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

| Kind          | Opened by                 | You see it when                                                     |
| ------------- | ------------------------- | ------------------------------------------------------------------- |
| `team`        | `POST /api/teams`         | its `minTier` ≤ yours                                               |
| `event`       | `POST /api/events`        | its `minTier` ≤ yours **and** you can see the event (not cancelled) |
| `group`, `dm` | `POST /api/threads`       | you're a member                                                     |
| `ai`          | the assistant (not built) | you're a member                                                     |

A thread you can't see is `404 THREAD_NOT_FOUND` on every route below — never
`403`, which would confirm it exists.

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
  "memberIds": ["<uuid>", "<uuid>"],
  "lastReadAt": "2026-09-17T09:00:00.000Z",
  "unreadCount": 2,
  "lastMessageAt": "2026-09-17T10:00:00.000Z"
}
```

- **`memberIds` is only filled on `group`, `dm` and `ai` threads.** It is always
  `[]` on `team` and `event` threads, because `minTier` decides who is in them.
- **`unreadCount` counts messages after your `lastReadAt`, never your own.** On a
  team or event thread you've never marked read, `lastReadAt` is `null` and every
  message counts.
- **`name` is `null` only on a `dm`** — show the other member's name.

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
  "editedAt": null
}
```

`author` is stamped from your session; names come from `GET /api/members`.

| Endpoint                          | Who    | Input                    | Success                                          |
| --------------------------------- | ------ | ------------------------ | ------------------------------------------------ |
| `GET /api/threads`                | tier 0 | `?kind`                  | `200 { threads: [] }`, latest activity first     |
| `POST /api/threads`               | tier 0 | body below               | `201 { thread }` — `200` for a dm that exists    |
| `GET /api/threads/:id/messages`   | tier 0 | `?q&before&limit`        | `200 { messages: [], nextCursor }`, newest first |
| `POST /api/threads/:id/messages`  | tier 0 | `{ "body", "parentId" }` | `201 { message }`                                |
| `POST /api/threads/:id/read`      | tier 0 | —                        | `200 { thread }`, with `unreadCount: 0`          |
| `POST /api/tasks/:id/comments`    | tier 0 | `{ "body", "parentId" }` | `201 { message }`                                |
| `POST /api/tasks/:id/attachments` | tier 0 | body below               | `201 { message }`                                |

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
- Replies come back in the same list; group them by `parentId`.

### `POST /api/threads/:id/messages` · tier 0

**Replies are one level deep.** `parentId` must be a message in this thread
that isn't itself a reply, or it's a `422` on field `parentId`.

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
`approved` and `paid` rows. Returns `{ "expenses": [ … ], "total": 12 }`, newest
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
`{ "action": "reject", "reason": "…" }`, or
`{ "action": "mark_paid" }`. Approve/reject leaves `pending`; mark-paid leaves
`approved`. Returns `{ "expense": { … }, "budget": { … } }` with refreshed
budget context. A second or out-of-order decision is
`409 INVALID_EXPENSE_STATE`; approving/rejecting your own claim is
`422 OWN_EXPENSE`.

## AI

Every endpoint here returns `503 AI_DISABLED` unless `AI_ENABLED=1`, which is
**off by default**. Design and the full tool inventory:
[`superpowers/specs/2026-09-23-ai-assistant-design.md`](superpowers/specs/2026-09-23-ai-assistant-design.md).

| Endpoint                           | Who      | Input                          | Success                         |
| ---------------------------------- | -------- | ------------------------------ | ------------------------------- |
| `POST /api/ai/messages`            | tier 0   | `{ "text": "…", "seed": { } }` | `200 { message, proposals }`    |
| `GET /api/ai/briefing`             | tier 0   | —                              | `200 { briefing }`              |
| `POST /api/ai/proposals/apply`     | tier 0 † | `{ runId, operations, stats }` | `201 { events: [], tasks: [] }` |
| `POST /api/ai/threads/:id/summary` | tier 0   | —                              | `200 { summary }`               |

† Tier 0 gets you in the door. **Each operation inside `operations` is gated
separately**, against the same check its equivalent route uses:

| Operation                | Mirrors                        | Gate             |
| ------------------------ | ------------------------------ | ---------------- |
| Create event             | `POST /api/events`             | tier 1           |
| Create one task          | `POST /api/tasks`              | tier 0           |
| Create two or more tasks | `POST /api/tasks/bulk`         | tier 1           |
| Update task              | `PATCH /api/tasks/:id`         | tier 0           |
| Update task status       | `PATCH /api/tasks/:id/status`  | tier 0           |
| Update event             | `PATCH /api/events/:id`        | owner, or tier 1 |
| Update event status      | `PATCH /api/events/:id/status` | tier 1           |

`POST /api/ai/messages` appends to the caller's `ai` channel — created on first
use, named `"Assistant"` — and returns the assistant's reply together with any
proposals it staged. **This call writes no tasks and no events.** Proposals are
client state until applied.

`seed` is optional starting context from whichever surface opened the chat —
`{ "eventId": "<uuid>" }` from an event's "Plan with AI" button, for instance.
It only pre-loads what the assistant reads first; it grants no access the caller
does not already have, and a seed naming something they cannot see is ignored.

Apply body:

```json
{
  "runId": "<uuid>",
  "operations": [
    { "op": "create", "entity": "event", "ref": "$event1", "data": { "name": "Hackathon 2026" } },
    { "op": "create", "entity": "task", "data": { "title": "Book venue", "eventRef": "$event1" } },
    { "op": "update", "entity": "task", "id": "<uuid>", "data": { "assigneeIds": ["<uuid>"] } }
  ],
  "stats": { "proposed": 9, "kept": 7, "edited": 2 }
}
```

Things worth knowing before you test:

- **The model never emits a UUID.** Read tools issue short per-run handles
  (`T1`, `E2`) and the server resolves them. A handle this run never issued is
  `422 AI_OUTPUT_INVALID`, not a `404`.
- **Apply is all-or-nothing.** Every checked operation runs in one transaction,
  in dependency order — a staged event is created before the tasks that name it
  by `ref`, and the real id is substituted in. One bad reference writes nothing.
- **The payload is the _edited_ card**, so by apply time it is an ordinary form
  submission that happens to carry provenance. It is re-validated against the
  same shared schemas the manual routes use. Rows created or changed carry
  `ai_run_id`.
- **Proposals can only create and update.** There is no tool for deleting,
  cancelling an event, changing a role, creating an invite, or touching
  `expense` / `budget` / `event.allocation_cents` — so none of those can appear
  in `operations`.
- **`stats` is evaluation data**, written to `ai_run` and never acted on. The
  client computes it because it is the only party that knows what was unchecked
  or edited.
- **`POST /api/ai/threads/:id/summary` is ephemeral** — no summary row, no
  summary table, re-runnable. It reuses the threads route's own visibility
  check, so it can only summarise what you can already read.
- **`GET /api/ai/briefing`** returns today's briefing for the caller, generating
  and storing it as a message in their `ai` channel if none exists yet. A page
  refresh is not a model call.
- **Quota** is `AI_DAILY_RUN_CAP` `ai_run` rows per user per rolling 24h;
  exceeding it, or a provider 429, is `429 AI_QUOTA_EXCEEDED`.
- **Unparseable model output** is `422 AI_OUTPUT_INVALID` after one retry —
  never a partial write.

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
