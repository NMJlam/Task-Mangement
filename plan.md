# Auth + RBAC — Implementation Plan

Google OAuth (Better Auth, self-hosted in Express) + tier/capability RBAC for the
Club/Committee Task Platform. Built on the **existing Express + Vite** stack — not
Next.js. Companion diagram: `docs/auth-rbac-architecture.drawio`.

## Locked decisions (from the grilling session)

- **Stack:** Express backend + Vite SPA. Google OAuth via self-hosted Better Auth is already working; this plan adds the missing RBAC.
- **Identity:** Better Auth owns the account (`auth.user`); **`app_user` (public, Drizzle) is the membership record**, FK → `auth.user`. Two tables, linked. Authenticated ≠ authorised.
- **Two authz axes:**
  - **Tier** (`2` management / `1` director / `0` officer) — hierarchical visibility → `authorise(minTier)`.
  - **Capability** — discrete role-bound powers → `CAPABILITIES` map in `@ctp/shared`, `can(role, cap)`. Powers the "What changes" role-diff UI via `roleDiff(from,to)`.
- **6 roles → 3 tiers** via a STORED generated column. Roles are a code-defined enum in `shared`; DB stores `text` + `CHECK` (no `pgEnum`, no roles table).
- **Fail closed:** no session → 401; session but no `app_user` → 403.
- **Membership-management guard** (invite + role-change, `authorise(1)`): actor tier ≥ 1; grant only role at tier ≤ own; act only on target at current tier ≤ own; **self-demote allowed**; **vacancy guard** — a change dropping any role above `officer` to zero holders is rejected (promote a successor first).
- **Bootstrap:** local seed = test committee; prod = one seeded `president` `invite`, then invite-only. No `invited_by` column.
- **IDs:** app-generated UUIDv7 via one `newId()`; no `defaultRandom()`/`gen_random_uuid()`.

## Watch-outs (design corners that bite if ignored)

1. **Drizzle can't model Better Auth's `auth` schema** → `app_user.auth_user_id`'s FK to `auth.user` must be added via **raw SQL** in the migration, not Drizzle relations.
2. **UUIDv7 needs a source** — `uuid@^11` (`v7`) or a tiny impl. Add the dep; ban `defaultRandom()` (poisons v7 index locality) with a lint/grep guard.
3. **`authenticate` now does one DB lookup per request** — fine at ~20 members. Use `httpDb()` on the request path (prod/Neon), `nodeDb()` in tests.
4. **Capability enforcement lands per feature** — the `CAPABILITIES` map exists now (source of truth + diff UI), but you can't call `can(…,"expense:approve")` before expenses exist. The map grows one line at a time.

---

## Phase 0 — Shared vocabulary (`@ctp/shared`)

- [x] `shared/src/schemas/role/role.ts` — `roleSchema = z.enum([...6 roles])`, `ROLE_TIER: Record<Role, 0|1|2>`, `tierSchema`, `tierForRole()`.
- [x] `shared/src/auth/capabilities.ts` — `CAPABILITIES` map (`capability → Role[]`), `can(role, cap)`, `roleDiff(from, to) → { gains, removed }`. Seed with only currently-enforceable capabilities.
- [x] Extend `shared/src/schemas/auth-user/auth-user.ts` — `AuthUser` gains `role: roleSchema`, `tier: tierSchema`.
- [x] Export from `shared/src/index.ts`; run `npm run build:packages`.
- [x] Test: `shared` unit — every role maps to a tier; every role in `CAPABILITIES` is valid; `roleDiff` sanity (marketing_director → vice_president gains/removes non-empty).

## Phase 1 — Database (`@ctp/backend`)

- [x] `backend/src/db/id.ts` — `newId()` → UUIDv7. Add `uuid` dep.
- [x] **Delete** `backend/src/db/schema/users.ts` (wrong on all three counts: `googleSub` key, `pgEnum`, `defaultRandom`).
- [x] `backend/src/db/schema/app-user.ts` — `app_user`: `id uuid` PK (no default), `auth_user_id text NOT NULL UNIQUE`, `role text NOT NULL CHECK (...)`, `tier smallint GENERATED ALWAYS AS (CASE role ...) STORED`, `created_at timestamptz`.
- [x] `teams.ts` / `team-members.ts` FK into the deleted `users` — for this slice **remove them from `schema/index.ts`** (empty stubs, deferred to R5) or repoint their FK to `app_user`.
- [x] Migration: `db:generate`; hand-add the `auth.user` FK via raw SQL (watch-out #1); `db:migrate`.

## Phase 2 — Better Auth

- [x] `auth.ts` — no change needed for role (role lives in `app_user`, not Better Auth). Confirm `app.ts` mounts `/api/auth/*` (already wired).
- [x] Invite `user.create.before` hook is **Phase 5** (prod gate), not here.

## Phase 3 — Middleware

- [x] Rewrite `backend/src/middleware/auth/authenticate.ts` — `getSession`; 401 if none; look up `app_user` by `auth_user_id = session.user.id`; **403 if none** (fail closed); set `req.user = { id: app_user.id, email, role, tier }`.
- [x] Rewrite `backend/src/middleware/auth/authorise.ts` — `authorise(minTier: 0|1|2)` factory → 403 when `req.user.tier < minTier`.
- [x] Add `requireCapability(cap)` sibling (thin wrapper over `can`) — used as features land.
- [x] `routes/me/me.ts` — `MeResponse` now carries `role` + `tier`.

## Phase 4 — Role-change endpoint (the "change roles per endpoint" ask)

- [x] `backend/src/routes/members/members.ts` — `PATCH /api/members/:id/role`:
  - `authenticate → authorise(1) → validate({ role }) → handler`.
  - Service enforces the membership-management guard: grant-tier ≤ actor tier; target current tier ≤ actor tier; **vacancy guard**; self-demote allowed.
  - Guarded `UPDATE ... WHERE id = $1 AND role = $expected RETURNING *` (idempotent).
  - Return the updated member so the frontend can render `roleDiff`.
- [x] Shared: member/response schema for the endpoint.

## Phase 5 — Invites + prod bootstrap (near-term, pre-prod)

- [x] `schema/invite.ts` (id, email lowercased, role, expires_at, accepted_at, revoked_at; derived status; no unique on email).
- [x] `POST /api/invites` — `authorise(1)` + grant-tier ≤ actor tier cap.
- [x] Better Auth `user.create.before` hook — match a live invite on `emailVerified` email; else throw (no account created).
- [x] Prod seed: one `president` invite for the founder's email.

## Phase 6 — Frontend surface

- [x] `useMe` / `useAuth` expose `role` + `tier` (from `/api/me`, since Better Auth's session doesn't carry them).
- [x] `RequireAuth` / UI gate on `tier` and `can()`.
- [x] Role-change confirmation panel — green Gains / red Removed from `roleDiff(from, to)`.

## Phase 7 — Seed + verify

- [x] `db:seed` (local) — idempotent test committee across all tiers.
- [x] Tests: `authenticate` 401/403 (integration); `authorise` 403 (unit); role-change caps + vacancy guard (integration); shared map (unit).
- [x] `npm run verify`.

---

## Deferred (stays a design doc in the provided `schema.sql`)

`event`, `workstream`, `task`, `channel`, `chan_member`, `message`, `expense`,
`settings`, `notification`, `ai_run`, `team`/`team_member` (R5), and the AI/money/
chat service rules. Each `min_tier` column reuses the tier axis; each role-bound
action adds one line to `CAPABILITIES` when its feature is built.
