import { roleSchema } from "@ctp/shared";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { closeNodeDb, nodeDb } from "./client.js";
import { newId } from "./id.js";
import { appUsers, invites } from "./schema/index.js";

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
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${email}), hashtext('president'))`);
    const [existing] = await tx
      .select({ id: invites.id })
      .from(invites)
      .where(
        and(
          eq(invites.email, email),
          eq(invites.role, "president"),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
          gt(invites.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!existing) {
      await tx.insert(invites).values({
        id: newId(),
        email,
        role: "president",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
    }
  });
}

if (process.env.NODE_ENV !== "production") await seedLocal();
if (process.env.NODE_ENV === "production" || process.env.FOUNDER_EMAIL) await seedProduction();
await closeNodeDb();
