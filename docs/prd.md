# PRD — Club Task Platform

Team S1_CS_05 · FIT3161/3162. Companion to the RTM (owns Rn IDs & user-story
traces) and the Sem-1 FE prototype (`fe-html/`, the FE spec). Build details:
[`architecture.md`](architecture.md); RBAC: [`roles-and-permissions.md`](roles-and-permissions.md).

**Status:** ✅ built · 🟡 partial · ⬜ planned.

## Vision

One web app for a single club (MAC) where events, tasks, calendar, messages,
budget and membership live together with role-appropriate access — a committee
runs its semester from one dashboard. Tablet/desktop web only. Not mobile-native,
not live co-editing, not a doc/legal manager, no payment processing.

## Users & roles — two-axis model ([details](roles-and-permissions.md))

`authorise(minTier)` gates rank; `authoriseCapability(cap)` gates named-office powers.

| Tier      | Roles                               | Prototype label                                    | Can                                               |
| --------- | ----------------------------------- | -------------------------------------------------- | ------------------------------------------------- |
| 2 exec    | President, VP, Treasurer, Secretary | President / VP Marketing / Treasurer / Events Lead | full control, roles, budget                       |
| 1 lead    | Director                            | Committee                                          | create/edit events & tasks, run AI breakdowns     |
| 0 general | Officer                             | Member                                             | see events & RSVP, update own tasks, read threads |

Capabilities: `invite:create` (pres, sec, director) · `member:role-change`
(pres, VP) · `event:cancel` (**pres only**). Membership is invite-gated
(`app_user`); accounts (`auth.user`) can exist without it.

## Requirements

| R       | Name                                      | Band     | St  | Intent & as-built notes                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | ----------------------------------------- | -------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1      | Auth                                      | Must     | 🟡  | Google via **self-hosted Better Auth** (not raw OAuth); sole social provider. Server sessions, expiry, logout-invalidate. Email/pw = **dev-only**. Prototype's "Monash SSO"/password login is illustrative. Onboarding walkthrough (US-15) ⬜. Co-req R14.                                                                                                                                                                    |
| R2      | RBAC                                      | Must     | ✅  | Tier + capability (above). Role change effective next request, no re-auth. Fail-closed.                                                                                                                                                                                                                                                                                                                                       |
| R3      | Tasks                                     | Must     | 🟡  | CRUD; **multi-assignee** (not single); status `todo/in_progress/blocked/done`; priority `low/med/high/urgent`; link to event+workstream. Filters (assignee/event/workstream/status/priority + overdue) ✅. Prototype adds: **kanban+list toggle**, My/All scope, description, subtasks, tag, activity+comments ⬜. Dup-title warn (US-10) ⬜. Reminders + assign/status/mention notifications ⬜ (task route emits none yet). |
| R4      | Events                                    | Must     | ✅  | CRUD; window `startsAt/endsAt`, **venue**, type, attendance est. **Delete = soft-cancel** (`cancelled`), **pres-only** (`event:cancel`); notifies open-task assignees on cancel/date-change ✅. Detail tabs: Overview/Tasks/Thread/Files⬜/RSVPs⬜. RSVP tracker ⬜.                                                                                                                                                          |
| R5      | Task↔Event + Workstreams                  | Must     | ✅  | `eventId`+`teamId`, both nullable → standalone tasks. Bidirectional nav; unlink loses nothing.                                                                                                                                                                                                                                                                                                                                |
| R6      | Calendar                                  | Must     | 🟡  | Prototype = **month/week/day grid**, coloured chips, click-through, today highlight. Code today = agenda-list placeholder → grid is target ⬜.                                                                                                                                                                                                                                                                                |
| R7      | Dashboard + Search                        | Must ↑   | ⬜  | **Post-login home.** Stat strip, my tasks by due, this-week events w/ progress, right rail (today, recent activity, **committee load %** = US-17), **⌘K search** tasks/events/people (US-16). Pres sees completion% + member summaries. No dashboard route/search/load-metric yet; widgets' data exists.                                                                                                                      |
| R8      | Budget                                    | Should   | ✅  | Treasurer/Pres log expenses (desc/amount/category/date); lifecycle `pending→approved→paid`/`rejected`; per-event total + club summary (alloc/committed/spent cents, on-track/at-risk/critical). Others view-only. Finance UI + approval ✅. Stripe = future.                                                                                                                                                                  |
| R9      | Threads                                   | Must     | ✅  | Per-event threaded discussion (detail Thread tab + Messages `#channels`). Link a task; notify participants/assignees. Endpoints+schema ✅; `/task` convert-in-UI + mention notifs ⬜.                                                                                                                                                                                                                                         |
| R10     | Messaging (DMs)                           | Must ↑   | 🟡  | Prototype Messages = `#threads` **+ 1:1 DMs**, attachments, `/task`. Threads ✅ (R9); **DMs, attachments, `/task`** ⬜.                                                                                                                                                                                                                                                                                                       |
| R11     | File upload                               | Deferred | ⬜  | Docs/images on tasks/events, role-gated (Files tab). US-12.                                                                                                                                                                                                                                                                                                                                                                   |
| R12     | Cross-browser                             | Must     | ⬜  | Chrome/Edge/FF v100+, Safari v15+, ≥768px. Matrix run ⬜.                                                                                                                                                                                                                                                                                                                                                                     |
| R13     | Usability/a11y                            | Must     | 🟡  | 5-min navigable, no docs; onboarding (US-15) ⬜. shadcn/Radix + jsx-a11y give kbd/ARIA. WCAG 2.1 AA: 1.4.3, 2.1.1, 1.3.1, 1.4.4 (axe e2e). MAC-palette contrast recheck pending (`TODO(theme)`).                                                                                                                                                                                                                              |
| R14     | Security                                  | Must     | 🟡  | OAuth (no implicit), HTTPS-only, no plaintext creds (dev-pw excluded from prod). Session expiry+logout. `httpDb()` sole prod driver (throws on localhost); `nodeDb()` local/test only. Monash privacy; no external sharing. Full hardening audit ⬜.                                                                                                                                                                          |
| **R15** | **AI Task Breakdown** _(new, not in RTM)_ | Deferred | ⬜  | Chat-refine event → draft tasks from past events (**Plan**); workload-balanced **Smart-assign** w/ reasoning + optimise-for toggles; **history** w/ 👍/👎. Human approves before publish. Vision/context only — not committed, doesn't gate MVP.                                                                                                                                                                              |

↑ = band raised vs RTM (R7, R10). Notifications currently in-app only; prototype
Inbox adds an **email** channel + **`ai`** kind ⬜.

## Prototype screens → R

Dashboard→R7 · Events(list/detail tabs)→R4,R5,R8,R9,R11 · Tasks(kanban/list/drawer)→R3 ·
Calendar→R6 · AI Breakdown→R15 · Messages(#+DM)→R9,R10 · Members→R2,R7(US-17) ·
Inbox→R3,R9 · Settings→R2,R13 · Login→R1,R14.

## Build order & release

`R1+R14 → R2 → R3,R4 → R5,R6,R9 → R7,R10 → R8`; deferred R11,R15 last.
R15 needs R3+R4 + a task corpus.

- **MVP (Must):** R1–R7, R9, R10, R12–R14
- **Stretch (Should):** R8
- **Deferred (Could):** R11, R15
