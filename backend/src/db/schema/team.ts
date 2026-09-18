import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { appUsers } from "./app-user.js";
import { notBlank } from "./sql-enum.js";
import { uuidShape } from "./sql-uuid.js";

/**
 * A team. A FLAT list — Exec, Media, Marketing, Sponsorship, Events — with no
 * parent, no rank, and no authority over each other. Teams group work; tier
 * ranks people. Keeping those apart is most of this design.
 *
 * TODO(R5): description. Club scoping is deliberately NOT here — there is
 * exactly one committee, so no tenant column anywhere.
 */
export const teams = pgTable(
  "team",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull().unique(),

    // A single column, not a second role system: a lead's authority comes from
    // their tier. This is also where a director's PORTFOLIO comes from —
    // "Marketing Director" means the director who leads the Marketing team.
    // There is no portfolio column; it would be a second fact able to disagree.
    lead: uuid("lead").references(() => appUsers.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("team_name_not_blank_check", notBlank(table.name)),
    check("team_uuid_shape_check", uuidShape(table.id, table.lead)),
  ],
);
