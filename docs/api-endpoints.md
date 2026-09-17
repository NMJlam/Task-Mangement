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
  event risk `on_track | at_risk | critical`.
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

Query: `?reassignTo=<uuid>` — hands the departing member's open tasks to someone
else.

| Response               | When                                                 |
| ---------------------- | ---------------------------------------------------- |
| `204`                  | Removed, with their auth account.                    |
| `404 MEMBER_NOT_FOUND` | No such member.                                      |
| `409 ROLE_VACANCY`     | Last holder of a non-officer role.                   |
| `409 OPEN_TASKS`       | They hold open tasks and no `reassignTo` was given.  |
| `422 VALIDATION_ERROR` | `reassignTo` is unknown, or is the departing member. |

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
  "assignee": "<uuid or null>",
  "creator": "<uuid or null>",
  "title": "Book the venue",
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
range.

Create body — only `title` is required:

```json
{
  "title": "Book the venue",
  "eventId": "<uuid>",
  "teamId": "<uuid>",
  "assignee": "<uuid>",
  "status": "todo",
  "priority": "medium",
  "dueAt": "2026-10-01T09:00:00.000Z"
}
```

Things worth knowing before you test:

- **`creator` is stamped from your session.** Sending one in the body is ignored.
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
- **`completedAt` is derived from `status`.** Moving to `done` stamps it; moving
  out clears it. You never send it.
- **`PATCH` needs at least one field**; `{}` is a `422`.
- **Bulk is all-or-nothing** — one bad reference writes nothing.
- **Overdue** means past `dueAt` and not `done`. Tasks with no due date never
  appear.
- A missing task is `404 TASK_NOT_FOUND` on every `/tasks/:id` route.

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

| Response               | When                                                     |
| ---------------------- | -------------------------------------------------------- |
| `200 { "event": … }`   | Updated. `warnings` present only for the case below.     |
| `403 FORBIDDEN`        | Tier 0 and not the owner.                                |
| `404 EVENT_NOT_FOUND`  | No such event, or above your tier.                       |
| `409 BUDGET_EXCEEDED`  | New `allocationCents` breaks the club budget.            |
| `422 VALIDATION_ERROR` | `endsAt` before `startsAt`, or the `minTier` rule below. |

- **Dates are validated merged, not per-body.** `PATCH { startsAt }` is checked
  against the event's _stored_ `endsAt`.
- **Moving a date notifies, it doesn't reschedule.** Tasks left due after the
  new date come back in `warnings`; every assignee of an unfinished task gets an
  `event_date_changed` notification. The route never moves a due date for you.
- **Raising `minTier` is blocked** if it would hide the event from someone
  already assigned a task on it: `422`, field `minTier`.

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
every assignee of an unfinished task.

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
      "status": "planning"
    },
    {
      "kind": "task",
      "id": "<uuid>",
      "title": "Book the venue",
      "dueAt": "2026-09-28T09:00:00.000Z",
      "eventId": "<uuid>",
      "assigneeId": "<uuid>"
    }
  ]
}
```

One list discriminated on `kind`, sorted by date across both types. Events are
ranged on `startsAt`, tasks on `dueAt`; both are filtered by your tier, and
cancelled events never appear.

- **`teamId` excludes standing tasks.** `task.team_id` is nullable — committee
  work belonging to no team can't match a team filter.
- **No clash detection.** Deliberately absent: "clash" has no agreed definition
  (same-day vs. interval overlap) and `endsAt` is nullable, so half the rows
  have no interval to overlap. There is no `clashes` field.

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

`GET /api/cron/warm` → `{ "ok": true }` and `GET /api/cron/reminders` →
`{ "ok": true, "sent": 0 }`. Both are stubs.

No session — they need `Authorization: Bearer <CRON_SECRET>`, and answer
`401 UNAUTHORISED` otherwise. `CRON_SECRET` is empty by default locally, which
makes **every** call `401` until you set one.

## Fixture routes

Reference endpoints for the testing tiers, not features. Both are tier 0.

- **`POST /api/example`** — body `{ "name": "Ada", "email": "ada@example.com" }`
  → `200 { "ok": true, "received": { … } }`. Proves one schema validating on
  both sides.
- **`POST /api/example/audit`** — body
  `{ "action": "task.updated", "entityType": "task", "entityId": "<uuid>" }`
  (`entityId` optional) → `201 { "ok": true, "entry": { … } }`. Writes one
  `audit_log` row.
