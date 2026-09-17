import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { appUsers } from "./app-user.js";
import { events } from "./event.js";
import { teams } from "./team.js";

/**
 * One team's deliverable for one event. When several teams contribute to an
 * event — media films it, marketing posts about it, sponsorship secures
 * partners — each OWES something, not just attendance.
 *
 * This started as a join table and earned promotion because of `brief`:
 * everything else here is derivable from tasks, and the brief is not. Without
 * it, "media is involved but hasn't planned anything yet" is invisible.
 *
 * NO min_tier COLUMN. A workstream is visible exactly when its event is
 * (rule 16) — one fact, not two.
 *
 * Rows are created by `POST /api/events` (its `teamId`) or on first use by a
 * task naming the event and a team (`routes/tasks/service.ts`). There is no
 * workstream endpoint — `brief`, `lead` and `due_at` are seed-only until one
 * is needed.
 */
export const workstreams = pgTable(
  "workstream",
  {
    id: uuid("id").primaryKey(),

    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),

    // RESTRICT: a team that owes a deliverable cannot be deleted out from under
    // it. Rename the team instead.
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),

    brief: text("brief"),

    lead: uuid("lead").references(() => appUsers.id, { onDelete: "set null" }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Required as the target of task's composite foreign key, and correct in its
    // own right: one deliverable per team per event.
    unique("workstream_one_per_team_per_event").on(table.eventId, table.teamId),
    // The `GET /api/events` teamId filter is an EXISTS leading with team_id;
    // the unique index above leads with event_id and doesn't serve it.
    index("workstream_team_idx").on(table.teamId),
  ],
);
