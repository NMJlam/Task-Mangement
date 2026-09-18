# Production migrations & seeding

How to run `db:migrate` / `db:seed` against the **live** database behind
https://club-task-management-nmjlams-projects.vercel.app/.

## The one thing to get right: WHICH database

There are two lookalike Neon projects. The app reads exactly one:

| | Project | IDs | Status |
|---|---|---|---|
| ✅ | `capstone`, branch `production` | `--project-id steep-sun-09078807 --org-id org-small-heart-08695357` (personal "Nathan" org) | **The real production DB** |
| ❌ | `neon-indigo-park` (still-queen-34355465) | Vercel-integration org `org-rapid-salad-61405315` | Auto-created by the Vercel↔Neon integration, unused |

`neonctl` defaults to the wrong one. Always pass `--project-id` and `--org-id`
explicitly (also required inside `$(...)` — no TTY means no interactive prompt).

## Why not `vercel env run` / `vercel env pull`

The production `DATABASE_URL` etc. are stored as **Sensitive** env vars —
write-only. The CLI cannot read them ("Secret values cannot be pulled"), and
older CLIs silently deliver them as empty strings. Don't fight it; source the
URL from `neonctl` instead.

## Recipe

Each command is one self-contained line (shell state doesn't persist between
runs). `BETTER_AUTH_SECRET` just needs to be non-default for these scripts —
any placeholder works; it is not written anywhere.

**Both URL variables must be set.** `db:migrate` and `db:seed` reach Postgres
through `nodeDb()`, which prefers `DATABASE_URL_POOLED` over `DATABASE_URL`, and
`load-env.ts` then fills whichever one is missing from the repo-root `.env` —
where `DATABASE_URL_POOLED` points at Docker. Exporting only `DATABASE_URL`
therefore migrates/seeds **your local Docker database** and still prints
`✅ migrations applied`, with no error and no effect on production. Setting both
to the same Neon URL makes that impossible.

Migrate (idempotent):

```sh
export DATABASE_URL="$(neonctl connection-string production --project-id steep-sun-09078807 --org-id org-small-heart-08695357)"; export DATABASE_URL_POOLED="$DATABASE_URL"; BETTER_AUTH_SECRET=migrate-only-placeholder NODE_ENV=production npm run db:migrate
```

Seed with demo data (idempotent; `NODE_ENV=production` skips the local seed and
requires `FOUNDER_EMAIL`):

```sh
export DATABASE_URL="$(neonctl connection-string production --project-id steep-sun-09078807 --org-id org-small-heart-08695357)"; export DATABASE_URL_POOLED="$DATABASE_URL"; BETTER_AUTH_SECRET=migrate-only-placeholder SEED_DEMO=1 FOUNDER_EMAIL='nathan.lam.rt@gmail.com' NODE_ENV=production npm run db:seed
```

Run from the repo root. Success looks like `✅ migrations applied`; the seed
prints nothing on success. Because that message is printed by both the local and
the production path, confirm the target actually changed — a migration count
that did not move means the URL variables above were not both set:

```sh
psql "$(neonctl connection-string production --project-id steep-sun-09078807 --org-id org-small-heart-08695357)" -c "select count(*) as applied, max(created_at) as latest from drizzle.__drizzle_migrations"
```

## Verifying

```sh
psql "$(neonctl connection-string production --project-id steep-sun-09078807 --org-id org-small-heart-08695357)" -c "select (select count(*) from event) events, (select count(*) from task) tasks, (select count(*) from app_user) members"
```

Gotchas:

- Table names are **singular**: `event`, `task`, `team`, `invite`, `app_user`.
- `app_user` has no email column — join `auth."user"` on `auth_user_id`.
- Never paste the connection string itself into a chat/issue/log; always
  inline it via `$(neonctl …)`.

## Seed behaviour to remember

- Everything is idempotent (`ON CONFLICT DO NOTHING`, deterministic demo IDs) —
  safe to re-run.
- `seedProduction` **skips the invite for anyone who is already a member**, so
  it will not change an existing member's role (e.g. promote you to president).
  Role changes are a manual `UPDATE app_user SET role='…'`.
- Demo personas use `@demo.invalid` emails with `emailVerified=false` — they
  can never sign in; they're display data only.
- Invites expire after 7 days; re-run the seed to refresh them.
