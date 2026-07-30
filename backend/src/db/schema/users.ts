import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Three roles per the proposal. TODO(R3): confirm exact names/permissions
// against the RTM before wiring authorisation.
export const userRole = pgEnum("user_role", ["admin", "leader", "member"]);

/**
 * Users are keyed on the Google `sub` claim, NOT email (§4.4) — email can
 * change and be reassigned; `sub` is the stable account identifier.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Google OpenID `sub` claim — the real identity key.
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: userRole("role").notNull().default("member"),
  // TODO(R3): avatarUrl, and any club-membership fields the RTM requires.
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
