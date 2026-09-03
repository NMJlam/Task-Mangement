import { roleSchema } from "@ctp/shared";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { closeNodeDb, nodeDb } from "./client.js";
import { newId } from "./id.js";
import { appUsers, invites, settings } from "./schema/index.js";

/**
 * Creates the pinned settings row. `settings` is a singleton table (CHECK id = 1)
 * holding the club budget pool, and the service layer assumes the row exists —
 * rule 1 takes SELECT ... FOR UPDATE on it. ON CONFLICT DO NOTHING keeps the
 * seed idempotent.
 */
async function seedSettings(): Promise<void> {
  await nodeDb().insert(settings).values({ id: 1 }).onConflictDoNothing();
}

async function seedLocal(): Promise<void> {
  const db = nodeDb();
  const now = new Date();

  for (const role of roleSchema.options) {
    const authUserId = `seed-${role}`;
    await db.execute(sql`
      INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${authUserId}, ${role.replaceAll("_", " ")}, ${`${role}@example.com`}, true, ${now}, ${now})
      ON CONFLICT (id) DO NOTHING
    `);
    await db
      .insert(appUsers)
      .values({ id: newId(), authUserId, role })
      .onConflictDoNothing({ target: appUsers.authUserId });
  }
}

async function seedProduction(): Promise<void> {
  const email = process.env.FOUNDER_EMAIL?.toLowerCase();
  if (!email) throw new Error("FOUNDER_EMAIL is required for the production bootstrap seed.");

  const db = nodeDb();
  await db.transaction(async (tx) => {
    // Serialises concurrent seeds so two runs cannot both find "no live invite"
    // and both insert one.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${email}), hashtext('president'))`);
    const now = new Date();
    const [existing] = await tx
      .select({ id: invites.id })
      .from(invites)
      .where(
        and(
          eq(invites.email, email),
          eq(invites.role, "president"),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
          gt(invites.expiresAt, now),
        ),
      )
      .limit(1);

    // No revoke-then-insert dance any more. That existed only to work around
    // the partial unique index on open invites, which could not express
    // "expires_at > now()" (now() is not immutable, index predicates must be) —
    // so a lapsed invite blocked re-inviting the same address. The index is
    // gone; duplicate live invites are harmless because authenticate.ts takes
    // the newest with ORDER BY expires_at DESC LIMIT 1 FOR UPDATE.
    if (!existing) {
      await tx.insert(invites).values({
        id: newId(),
        email,
        role: "president",
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      });
    }
  });
}

await seedSettings();
if (process.env.NODE_ENV !== "production") await seedLocal();
if (process.env.NODE_ENV === "production" || process.env.FOUNDER_EMAIL) await seedProduction();
await closeNodeDb();
