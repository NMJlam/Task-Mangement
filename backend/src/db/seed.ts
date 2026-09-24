import { roleSchema } from "@ctp/shared";
import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { closeNodeDb, nodeDb } from "./client.js";
import { newId } from "./id.js";
import { appUsers, invites, settings } from "./schema/index.js";
import { demoInvitees, seedDemo } from "./seed-demo.js";

/**
 * Creates the pinned settings row. `settings` is a singleton table (CHECK id = 1)
 * holding the club budget pool, and the service layer assumes the row exists —
 * rule 1 takes SELECT ... FOR UPDATE on it. ON CONFLICT DO NOTHING keeps the
 * seed idempotent.
 */
async function seedSettings(demoEnabled: boolean): Promise<void> {
  await nodeDb()
    .insert(settings)
    .values({ id: 1, budgetCents: demoEnabled ? 1_000_000 : 0 })
    .onConflictDoNothing();
}

/**
 * The roles the local seed creates accounts for.
 *
 * `president` is deliberately absent: the club has one president, and it is a
 * real account — the one `FOUNDER_EMAIL`'s invite creates on first sign-in (see
 * `seedProduction`). A seeded `president@example.com` would be a second holder
 * of the office, and the demo fixtures that name a president would attach to a
 * fixture nobody can sign in as rather than to the person running the club.
 */
const LOCAL_ROLES = roleSchema.options.filter((role) => role !== "president");

async function seedLocal(): Promise<void> {
  const db = nodeDb();
  const now = new Date();

  for (const role of LOCAL_ROLES) {
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

async function seedProduction(demoEnabled: boolean): Promise<void> {
  const invitees = demoInvitees(
    process.env.FOUNDER_EMAIL,
    demoEnabled ? process.env.DEMO_DIRECTOR_EMAILS : undefined,
  );
  const db = nodeDb();
  await db.transaction(async (tx) => {
    for (const { email, role } of invitees) {
      // Serialises concurrent seeds so two runs cannot both find "no live invite"
      // and both insert one.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${email}), hashtext('demo-bootstrap'))`,
      );
      const member = await tx.execute<{ exists: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1
          FROM "app_user" member
          JOIN auth."user" account ON account."id" = member."auth_user_id"
          WHERE lower(account."email") = ${email}
        ) AS "exists"
      `);
      if (member.rows[0]?.exists) continue;

      const now = new Date();
      await tx
        .update(invites)
        .set({ revokedAt: now })
        .where(
          and(
            eq(invites.email, email),
            ne(invites.role, role),
            isNull(invites.acceptedAt),
            isNull(invites.revokedAt),
            gt(invites.expiresAt, now),
          ),
        );
      const [existing] = await tx
        .select({ id: invites.id })
        .from(invites)
        .where(
          and(
            eq(invites.email, email),
            eq(invites.role, role),
            isNull(invites.acceptedAt),
            isNull(invites.revokedAt),
            gt(invites.expiresAt, now),
          ),
        )
        .limit(1);

      if (!existing) {
        await tx.insert(invites).values({
          id: newId(),
          email,
          role,
          expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        });
      }
    }
  });
}

const demoEnabled = process.env.SEED_DEMO === "1";
const production = process.env.NODE_ENV === "production";
await seedSettings(demoEnabled);
if (!production) await seedLocal();
if (production || process.env.FOUNDER_EMAIL) await seedProduction(demoEnabled);
if (demoEnabled) await seedDemo(production);
await closeNodeDb();
