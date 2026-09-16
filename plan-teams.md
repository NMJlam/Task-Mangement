# Teams + Members (R5) — Implementation Plan

Team CRUD, team staffing, the member roster and member offboarding for the
Club/Committee Task Platform. Sits on the shipped auth/RBAC slice (`plan.md`) and
follows the CRUD precedent set by `backend/src/routes/tasks/tasks.ts` (R7).

Named `plan-teams.md` rather than replacing `plan.md`, which is the completed R2
record.

## Where the endpoints come from

Nothing here is invented. Each route is derived from one of four sources:

1. **The tables** — `backend/src/db/schema/team.ts` and `team-member.ts` say what
   can be stored. `team_member` has exactly two columns and both are the primary
   key, so a membership row can be created or destroyed but never _updated_.
2. **The FK on-delete map** — dictates which deletes need a guard. Every FK into
   `app_user` is `SET NULL` or `CASCADE`, so removing a member silently orphans
   their open tasks; `workstream.team_id` and `expense.team_id` are `RESTRICT`,
   so deleting a referenced team raises `23503` instead of succeeding.
3. **The schema spec** — `docs/superpowers/specs/2026-08-27-database-schema-design.md`,
   specifically the read paths it names (the sidebar's "which teams am I in",
   which is the only reason `team_member_user_idx` exists; the roster's derived
   portfolio join at §4) and rules 6, 7 and 15 in §8.
4. **The shipped conventions** — tier gating over new capabilities, `validate`
   twice (params then body), 422 for an unresolvable foreign key, `satisfies` on
   every response.

## Locked decisions

- **Tier, not capability.** Team management is tier-bound, so no new entries in
  `CAPABILITIES`. That map is the source of the role-diff UI and only grows when a
  power is bound to a role _by name_ (`plan.md` watch-out 4; the same call
  `tasks.ts` made).
  - tier 0 — read the roster, read teams.
  - tier 1 — staff a team, but only a team you `lead`.
  - tier 2 — create, rename, re-lead, delete a team; offboard a member.
- **`GET /api/teams` carries `memberIds`.** Five teams and twenty members: one
  fetch serves the sidebar, the team page and the picker. No
  `GET /api/teams/:teamId/members`, and no `GET /api/teams/:id` — the list is the
  detail.
- **Membership is assigned, never requested.** `team_member` has no status
  column, so there is no join-request flow and no team-scoped invite.
- **`/members`, not `/users`.** `PATCH /api/members/:id/role` already shipped
  under that namespace; the table being `app_user` doesn't change the route.
- **No transactions.** The Neon HTTP driver has no interactive transactions, so
  offboarding is a fixed sequence of single statements, same reasoning as the
  bulk insert in `tasks.ts`.

## Watch-outs

1. **`auth.user` is declared with one column, and must stay that way.**
   `schema/auth.ts` exposes only `id`, so the roster cannot reach `name`/`email`
   through Drizzle. The obvious fix — adding them as read-only columns — is
   wrong, and was tried and reverted: `schemaFilter: ["public"]` stops
   drizzle-kit CREATE/DROPing the auth tables, but it still diffs **columns** on
   a table we declare, so `db:generate` emitted

   ```sql
   ALTER TABLE "auth"."user" ADD COLUMN "name" text NOT NULL;
   ALTER TABLE "auth"."user" ADD COLUMN "email" text NOT NULL;
   ```

   against columns Better Auth had already created. That migration fails on
   every database it touches. The roster reads those two columns in raw SQL
   instead, the same way `authenticate.ts` and the role-change CTE already reach
   into the `auth` schema.

2. **`PATCH` on a membership row is impossible.** Both columns are the PK. "Make
   this person the lead" is `PATCH /api/teams/:id` (the `lead` column lives on
   `team`, so a director's portfolio can't disagree with itself).
3. **Deleting a member is the risky operation.** `task.assignee` is `SET NULL`,
   so the database will happily orphan open tasks. Rules 7 and 15 must be
   enforced in the route, in order: reassign, delete `app_user`, delete auth user.
4. **Don't widen the base seed.** CI seeds before the integration tier, and
   `members.integration.test.ts` depends on `seed-treasurer` being the only
   treasurer. Team fixtures are created and cleaned by their own test file.

## Endpoints

| Method | Path                                 | Tier             | Notes                                                                                                                      |
| ------ | ------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/teams`                         | 0                | `?member=<uuid>` filters to that member's teams. Returns `lead` + `memberIds`.                                             |
| POST   | `/api/teams`                         | 2                | Duplicate name → 409 `TEAM_NAME_TAKEN`. Unknown `lead` → 422.                                                              |
| PATCH  | `/api/teams/:id`                     | 2                | Rename and/or set `lead`. Empty body → 422.                                                                                |
| DELETE | `/api/teams/:id`                     | 2                | Referenced by a workstream or expense → 409 `TEAM_IN_USE`.                                                                 |
| PUT    | `/api/teams/:teamId/members/:userId` | 1 (own team) / 2 | Idempotent add → 204.                                                                                                      |
| DELETE | `/api/teams/:teamId/members/:userId` | 1 (own team) / 2 | Idempotent remove → 204.                                                                                                   |
| GET    | `/api/members`                       | 0                | Roster: role, tier, name, email, `teamIds`, derived `portfolio`.                                                           |
| PATCH  | `/api/members/:id/role`              | 1                | **Already shipped.**                                                                                                       |
| DELETE | `/api/members/:id`                   | 2                | `?reassignTo=<uuid>`. Open tasks and no target → 409 `OPEN_TASKS`. Last holder of a non-officer role → 409 `ROLE_VACANCY`. |

## Not building

- `POST /api/members` — membership is claimed from a live invite inside
  `authenticate` (rule 12). An endpoint that inserts `app_user` directly is a
  hole in the invite gate.
- `POST /api/teams/:teamId/invites` — `invite` has no `team_id`; it is a club
  gate, not a team gate. Covered by the shipped `POST /api/invites`.
- `GET /api/teams/:id`, `GET /api/teams/:teamId/members` — the list response
  already carries both.
- `PATCH /api/teams/:teamId/members/:userId` — nothing on that row is mutable.
- Auto-creating the `kind = 'team'` channel on team create — channels have no
  routes yet.
- New indexes. Five teams, twenty members.

## Phases

### Phase 1 — Shared vocabulary

- [x] `shared/src/schemas/team/team.ts` — `teamSchema`, `teamWithMembersSchema`,
      `createTeamSchema`, `updateTeamSchema` (non-empty `.refine`),
      `teamParamsSchema`, `teamMemberParamsSchema`, `listTeamsQuerySchema`,
      responses.
- [x] `shared/src/schemas/member/member.ts` — `memberParamsSchema` (which
      `changeMemberRoleParamsSchema` now aliases), `rosterMemberSchema`,
      `memberListResponseSchema`, `removeMemberQuerySchema`.
- [x] Export both from `shared/src/index.ts`. Unit tests, no DB.

### Phase 2 — Roster

- [x] `GET /api/members` in the existing `routes/members/members.ts`, reading
      `auth.user` in raw SQL — see watch-out 1 for why NOT to declare those
      columns in `schema/auth.ts`.
- [x] `npm run db:generate` reports "No schema changes, nothing to migrate".

### Phase 3 — Teams

- [x] `backend/src/routes/teams/teams.ts` — GET, POST, PATCH, DELETE.
- [x] Register in `routes/index.ts`.

### Phase 4 — Staffing

- [x] `PUT` / `DELETE /api/teams/:teamId/members/:userId`, with the lead gate.

### Phase 5 — Offboarding

- [x] `DELETE /api/members/:id` — vacancy guard, then reassign, then
      `app_user`, then auth user. Separate PR; it is the only destructive route.

### Phase 6 — Verify

- [x] `teams.integration.test.ts`, roster + offboarding cases in
      `members.integration.test.ts`.
- [x] `typecheck`, `lint`, `format:check`, `test:unit`, `db:generate`.
- [ ] `test:integration` and `test:e2e` — **not yet run**: they need Docker
      Postgres up and a `.env`, neither of which existed on the machine the code
      was written on. Run `docker compose up -d && npm run db:migrate &&
npm run db:seed && npm run verify` before opening the PR.

## Rules the routes own

1. Duplicate team name → `23505` → 409 `TEAM_NAME_TAKEN`.
2. Unknown `lead` / `userId` → 422 naming the field.
3. Team still referenced → `23503` → 409 `TEAM_IN_USE`, never a 500.
4. Tier 1 may only staff a team they `lead`; tier 2 may staff any.
5. Offboarding order is fixed (rule 15) and vacancy-guarded (rule 6).
6. `lead` need not be a member of the team — the schema doesn't require it, so
   neither do we.
