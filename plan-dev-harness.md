# Dev sign-in + scratch page — Implementation Plan

A local-only way to exercise the API by hand in a browser: a dev sign-in that
doesn't need Google, and a one-page request runner. None of it ships.

Named `plan-dev-harness.md` alongside `plan-teams.md`, which is the R5 record.

## Why this is needed

Google is the only sign-in method (`backend/src/auth/auth.ts`) and
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are empty in `.env`, so nobody can
hold a session in the browser and every protected route answers 401.
`GET /api/health` is the only endpoint reachable from the frontend today.

## Locked decisions

- **Opt-in env flag, not `NODE_ENV`.** `DEV_PASSWORD_AUTH=1` enables Better
  Auth's credential provider. Absent means off, so production is off by default
  instead of off-only-if-someone-set-`NODE_ENV`.
- **The page is dev-build only.** `/scratch` is registered behind
  `import.meta.env.DEV`, so Vite drops it from the production bundle. R14's
  per-page axe scan doesn't apply to a page that never ships.
- **Membership comes from a CLI, not an endpoint.** A route that grants you a
  role is a hole in the invite gate even when env-gated.
  `npm run db:dev-member -- <email> <role>` writes `app_user` directly.
- **One dev account, re-roled.** Don't give the six seeded members passwords:
  their `auth.user` rows already exist, and attaching credentials to them means
  hashing passwords outside Better Auth. Sign up once, then change that row's
  role to exercise each tier.
- **Not behind `RequireAuth`.** 401 and 403 are the responses under test; a
  guard would hide them.
- **No new dependencies.** `fetch`, the installed shadcn `Button` / `Input`,
  and `authClient`.

## Watch-outs

1. **Credential sign-ups have `emailVerified = false`.** `authenticate.ts`
   claims an invite only when the email is verified, so the invite path will NOT
   fire for the dev account. Membership has to come from the CLI — that is the
   reason the CLI exists, not a nice-to-have.
2. **`auth.account.password` must exist.** Better Auth's migration ran while the
   config had only a social provider. Verify before Phase 3 with
   `\d auth.account`; if `password` is missing, re-run `npm run db:migrate`.
3. **Docker Postgres is down on this machine** (`docker ps` fails; the daemon
   isn't running). `docker compose up -d` first — nothing here can be checked
   without it.
4. **`no any`, `strict: true`.** The response body is `unknown`; render it with
   `JSON.stringify`, never a cast.
5. **`frontend/` may not import `backend/`** (CLAUDE.md rule 2). The page talks
   HTTP only.
6. **Don't touch the Google path.** `socialProviders` stays exactly as it is, so
   the real flow still works the moment the credentials are filled in.

## Phases

### Phase 1 — Dev credential sign-in

- [x] `backend/src/env.ts`: export `DEV_PASSWORD_AUTH`, true only for `"1"`.
- [x] `backend/src/auth/auth.ts`: `emailAndPassword: { enabled: DEV_PASSWORD_AUTH }`,
      with a comment on why it is opt-in and local-only.
- [x] `.env.example` (empty) and local `.env` (`=1`), commented "local only,
      never set on Vercel".
- [x] Check: `POST /api/auth/sign-up/email` returns a user and sets a cookie.

### Phase 2 — Membership CLI

- [x] `backend/src/db/dev-member.ts`: `<email> [role=president]`, finds the
      `auth.user` by email, upserts `app_user`, prints the row. Refuses when
      `NODE_ENV === "production"`.
- [x] `db:dev-member` script in `backend/package.json` and the root
      `package.json` (the root delegates, like `db:seed`).
- [x] Check: `GET /api/me` 403 before, the role and tier after; re-run with
      `officer` and the tier drops to 0.

### Phase 3 — Scratch page

- [x] `frontend/src/routes/scratch.tsx`: email + password sign-in / sign-up
      (`authClient.signIn.email` / `signUp.email`), a line showing the current
      session, and the request runner — method `<select>`, path `<input>`, JSON
      body `<textarea>`, Send — rendering status + pretty-printed JSON.
- [x] `frontend/src/main.tsx`: register `/scratch` only under
      `import.meta.env.DEV`.
- [x] `frontend/src/routes/scratch.test.tsx`: renders, and Send calls `fetch`
      with the chosen method/path/body and shows the status (stubbed `fetch`).

### Phase 4 — Docs

- [x] `docs/setup.md`: "Test endpoints by hand in the browser (dev only)" — the
      commands, the role CLI, and the local-only warning.
- [x] `docs/roles-and-permissions.md`: one line pointing at it, so the rules
      table says how to try the rules.

### Phase 5 — Verify

- [x] `docker compose up -d && npm run db:migrate && npm run db:seed`.
- [x] By hand: sign up on `/scratch` → `GET /api/me` 403 → CLI → 200 →
      `POST /api/teams` as `officer` 403 → as `president` 201.
- [x] `npm run verify`.

## Not building

- A role-switch button on the page. It needs a backend hole; the CLI is safer.
- Passwords for the six seeded members (see locked decisions).
- Real feature UI — teams list, task board. That is R5/R7 product work; this
  harness is throwaway.
- Saved requests, history, or anything else resembling Postman. If it outgrows
  one file, use Bruno instead.
- An axe scan or e2e spec: the page never ships.

## Rules this owns

1. `DEV_PASSWORD_AUTH` unset means credential sign-in is off. Production gains
   no second sign-in path.
2. `/scratch` does not exist in a production build.
3. Membership stays invite-gated everywhere except the local-only CLI.

## Status — built 2026-09-16

All five phases done; `npm run verify` green (61 unit, 98 integration, 2 e2e).

- Watch-out 2 cleared: `auth.account.password` already existed, no migration.
- Watch-out 1 confirmed in practice: the fresh account got 403 `NO_MEMBERSHIP`
  until the CLI ran, exactly as predicted.
- The acceptance path was driven with curl against the real server, not by
  clicking: sign-up 200 → `/api/me` 403 → CLI officer → `/api/me` 200 tier 0 →
  `POST /api/teams` 403 → CLI president → 201 → team deleted again.
- The page itself is covered by `scratch.test.tsx`; nobody has opened
  `/scratch` in a real browser yet. That is the one thing left to try.
- Production build checked: `API scratch pad` does not appear in `dist/`.
