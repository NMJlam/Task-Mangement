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
  task priority `low | medium | high | urgent`.

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

| Endpoint                      | Who    | Input                                           | Success                                |
| ----------------------------- | ------ | ----------------------------------------------- | -------------------------------------- |
| `GET /api/tasks`              | tier 0 | `?teamId&status&priority&assignee&limit&offset` | `200 { tasks: [] }`, newest first      |
| `GET /api/tasks/overdue`      | tier 0 | `?teamId&assignee&limit&offset`                 | `200 { tasks: [] }`, soonest due first |
| `GET /api/tasks/:id`          | tier 0 | —                                               | `200 { task }`                         |
| `POST /api/tasks`             | tier 0 | body below                                      | `201 { task }`                         |
| `POST /api/tasks/bulk`        | tier 1 | `{ "tasks": [ … ] }`, 1–100                     | `201 { tasks: [] }`                    |
| `PATCH /api/tasks/:id`        | tier 0 | any subset of the create body                   | `200 { task }`                         |
| `PATCH /api/tasks/:id/status` | tier 0 | `{ "status": "done" }`                          | `200 { task }`                         |
| `DELETE /api/tasks/:id`       | tier 1 | —                                               | `204`                                  |

`limit` is 1–100 (default 50), `offset` defaults to 0. Both `422` if out of
range.

Create body — only `title` is required:

```json
{
  "title": "Book the venue",
  "teamId": "<uuid>",
  "assignee": "<uuid>",
  "status": "todo",
  "priority": "medium",
  "dueAt": "2026-10-01T09:00:00.000Z"
}
```

Things worth knowing before you test:

- **`creator` is stamped from your session.** Sending one in the body is ignored.
- **An unknown `teamId` or `assignee` is a `422`**, with code `TEAM_NOT_FOUND` or
  `ASSIGNEE_NOT_FOUND` — not a `404`, because it's your input that's wrong.
- **`completedAt` is derived from `status`.** Moving to `done` stamps it; moving
  out clears it. You never send it.
- **`PATCH` needs at least one field**; `{}` is a `422`.
- **Bulk is all-or-nothing** — one bad reference writes nothing.
- **Overdue** means past `dueAt` and not `done`. Tasks with no due date never
  appear.
- A missing task is `404 TASK_NOT_FOUND` on every `/tasks/:id` route.

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
