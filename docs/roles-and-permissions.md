# Roles & permissions

Who can do what, as the code enforces it today. If this page and the code
disagree, the code wins and this page has a bug — fix it in the same PR.

- Role → tier: `ROLE_TIER` in `shared/src/schemas/role/role.ts`
- Role → powers: `CAPABILITIES` in `shared/src/auth/capabilities.ts`
- Per route: the `authorise(...)` and `can(...)` calls in `backend/src/routes/`
- Try the rules by hand: [setup.md — test endpoints in the browser](setup.md#test-endpoints-by-hand-in-the-browser-dev-only)
- Design intent: [schema spec §4 and §8](superpowers/specs/2026-08-27-database-schema-design.md);
  diagram: [`auth-rbac-architecture.drawio`](auth-rbac-architecture.drawio)

## Two axes

- **Tier** (0–2) is rank, and the only hierarchy in the system. Routes gate on
  it with `authorise(minTier)`, which lets that tier **and above** through.
- **Role** is the named office. A few powers belong to an office **by name**,
  checked with `can(role, capability)`, because rank alone shouldn't grant them.

`app_user.tier` is a generated column computed from `role`, so the two can never
disagree. Within a tier, roles are peers: a president doesn't outrank a
treasurer. Only their capabilities differ.

## Roles

| Role             | Tier | Capabilities                          |
| ---------------- | ---- | ------------------------------------- |
| `president`      | 2    | `member:role-change`, `invite:create` |
| `vice_president` | 2    | `member:role-change`                  |
| `secretary`      | 2    | `invite:create`                       |
| `treasurer`      | 2    | —                                     |
| `director`       | 1    | `invite:create`                       |
| `officer`        | 0    | —                                     |

## Endpoints

"Tier n" means tier n or above. Every route except health and cron needs a
signed-in account with club membership: 401 without a session, 403
`NO_MEMBERSHIP` without membership.

| Endpoint                                                                 | Minimum    | Also requires                                                            |
| ------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------ |
| `GET /api/health`                                                        | public     | —                                                                        |
| `GET /api/me`, `GET /api/members`, `GET /api/teams`                      | tier 0     | —                                                                        |
| `GET /api/tasks`, `/api/tasks/overdue`, `/api/tasks/:id`                 | tier 0     | —                                                                        |
| `POST /api/tasks`, `PATCH /api/tasks/:id`, `PATCH /api/tasks/:id/status` | tier 0     | —                                                                        |
| `DELETE /api/tasks/:id`, `POST /api/tasks/bulk`                          | tier 1     | —                                                                        |
| `PUT`, `DELETE /api/teams/:teamId/members/:userId`                       | tier 1     | Tier 1: only a team they lead. Tier 2: any team.                         |
| `POST /api/invites`                                                      | tier 1     | `invite:create`; the invited role's tier ≤ yours                         |
| `PATCH /api/members/:id/role`                                            | tier 1     | `member:role-change`; new role and target both ≤ your tier; rule 3 below |
| `POST /api/teams`, `PATCH`, `DELETE /api/teams/:id`                      | tier 2     | —                                                                        |
| `DELETE /api/members/:id`                                                | tier 2     | Rules 3 and 4 below                                                      |
| Cron routes (`routes/cron/cron.ts`)                                      | no session | `Authorization: Bearer <CRON_SECRET>`                                    |

## Rules

1. **Never above your own tier.** You can't invite someone into, or promote
   someone to, a role above your tier, and you can't change the role of someone
   above you. Equal tier is allowed.
2. **Tier and capability, both.** Role changes need `member:role-change` and
   invites need `invite:create`, on top of the tier gate.
3. **No office left empty.** The last holder of any role except `officer` can't
   be demoted or removed: 409 `ROLE_VACANCY`. Promote a successor first. (Spec
   rule 6 names only the president; the code applies it to every office.)
4. **Offboarding hands over work.** A member with open tasks can't be removed
   without `?reassignTo=<member id>`: 409 `OPEN_TASKS`. (Spec rules 7 and 15.)
5. **Team lead is not a role.** It's the `team.lead` column, and the lead's
   authority comes from their tier. A director's portfolio ("Marketing
   Director") is derived from the team they lead, never stored.

## Deliberate, but easy to trip over

- Only the president and VP can change roles; only the president, secretary and
  directors can invite. So the VP can promote but not invite, and the secretary
  can invite but not promote.
- Any tier-2 role can remove a member, including the treasurer and secretary.
  There's no target-tier check because a tier-2 actor is never below their
  target.
- An officer who is set as a team's lead still can't add or remove its members.
  Staffing starts at tier 1.

## Not built yet

- **Hiding content by tier.** `task`, `event` and `channel` have a `min_tier`
  column ("tier answers what can I see"), but no route filters on it yet, so
  every member sees every task. Spec §8 rules 3–5.
- **Budget powers.** Spec §4 gives budget authority to `treasurer` and
  `president` by name. No expense routes exist yet; when they do, that's a
  `CAPABILITIES` entry, not a tier gate.

## Open question

- **Can a president demote themselves?** Spec rule 6 says no. The code only
  blocks it when they're the last president, so with two presidents either one
  can step down. Decide which is right, then fix the code or the spec.

## Adding a route or a power

- Gate on **tier** when the power comes with rank. Add a `CAPABILITIES` entry
  only when it belongs to a named office — that map also drives the gains and
  removals shown when someone's role changes.
- Add the route to the endpoint table above.
