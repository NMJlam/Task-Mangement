import { roleSchema } from "@ctp/shared";
import { sql } from "drizzle-orm";
import { closeNodeDb, nodeDb } from "./client.js";
import { newId } from "./id.js";
import { appUsers } from "./schema/index.js";

/**
 * Local-only: gives an existing auth account club membership, or re-roles the
 * membership it already has.
 *
 * The invite gate in `authenticate.ts` claims an invite only for a VERIFIED
 * email, and a password sign-up is never verified — so this is how a dev
 * account becomes a member, and how you switch tiers while testing by hand.
 * Deliberately a CLI and not a route: an endpoint that grants you a role is a
 * hole in the invite gate even behind an env flag. See plan-dev-harness.md.
 *
 *   npm run db:dev-member -- dev@example.com president
 */
if (process.env.NODE_ENV === "production") {
  throw new Error("db:dev-member is local-only and refuses to run in production.");
}

const [email, roleArg = "president"] = process.argv.slice(2);
if (!email) throw new Error("Usage: npm run db:dev-member -- <email> [role]");

const role = roleSchema.parse(roleArg);
const db = nodeDb();

const found = await db.execute<{ id: string }>(
  sql`SELECT id FROM auth."user" WHERE lower(email) = ${email.toLowerCase()} LIMIT 1`,
);
const authUserId = found.rows[0]?.id;
if (!authUserId) {
  throw new Error(`No account for ${email}. Sign up at /scratch first, then re-run this.`);
}

// tier is generated from role, so re-running with a different role moves the
// account up or down the tier axis with no second fact to keep in sync.
const [member] = await db
  .insert(appUsers)
  .values({ id: newId(), authUserId, role })
  .onConflictDoUpdate({ target: appUsers.authUserId, set: { role } })
  .returning();

console.log(`${email}: role ${member!.role}, tier ${member!.tier}`);
await closeNodeDb();
