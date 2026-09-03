import { pgSchema, text } from "drizzle-orm/pg-core";

/**
 * Better Auth's tables, declared READ-ONLY so Drizzle can express the foreign
 * key from `app_user` into them.
 *
 * Better Auth owns this schema and creates it through its own migration API
 * (see `db/migrate.ts`, which runs it BEFORE Drizzle). We declare only the one
 * column the FK needs. `drizzle.config.ts` sets `schemaFilter: ["public"]` so
 * drizzle-kit never tries to CREATE or DROP anything in here — it only needs the
 * declaration to resolve the reference.
 *
 * This replaces the hand-patched FK in the old migration 0001, which was
 * invisible to the snapshot and therefore to every diff (plan.md watch-out #1).
 */
export const authSchema = pgSchema("auth");

export const authUser = authSchema.table("user", {
  id: text("id").primaryKey(),
});
