import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app.js";
import { closeNodeDb, nodeDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { appUsers, events, expenses, settings } from "../../db/schema/index.js";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("../../auth/auth.js", () => ({ auth: { api: { getSession }, handler: vi.fn() } }));

const PREFIX = "test-budget-";

describe("/api/budget (integration)", () => {
  const db = nodeDb();
  let originalBudgetCents = 0;

  async function member(name: string, role: "treasurer" | "vice_president" | "officer") {
    const authUserId = `${PREFIX}${name}`;
    const email = `${PREFIX}${name}@example.com`;
    await db.execute(sql`
      INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${authUserId}, ${name}, ${email}, true, now(), now())
    `);
    const [row] = await db.insert(appUsers).values({ id: newId(), authUserId, role }).returning();
    return { ...row!, email };
  }

  function signInAs(actor: { authUserId: string; email: string }) {
    getSession.mockResolvedValue({ user: { id: actor.authUserId, email: actor.email } });
  }

  async function clean(): Promise<void> {
    await db.execute(sql`DELETE FROM "expense" WHERE description LIKE ${`${PREFIX}%`}`);
    await db.execute(sql`DELETE FROM "event" WHERE title LIKE ${`${PREFIX}%`}`);
    await db.execute(sql`DELETE FROM "app_user" WHERE "auth_user_id" LIKE ${`${PREFIX}%`}`);
    await db.execute(sql`DELETE FROM auth."user" WHERE id LIKE ${`${PREFIX}%`}`);
  }

  beforeAll(async () => {
    await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
    originalBudgetCents =
      (await db.select().from(settings).where(eq(settings.id, 1)))[0]?.budgetCents ?? 0;
  });

  beforeEach(async () => {
    getSession.mockReset();
    await clean();
    await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
  });

  afterAll(async () => {
    await clean();
    await db
      .update(settings)
      .set({ budgetCents: originalBudgetCents, updatedAt: new Date() })
      .where(eq(settings.id, 1));
    await closeNodeDb();
  });

  it("limits mutations to finance roles and reuses the guarded event allocation path", async () => {
    const treasurer = await member("treasurer", "treasurer");
    const vicePresident = await member("vice", "vice_president");
    const officer = await member("officer", "officer");
    const eventId = newId();
    await db.insert(events).values({ id: eventId, title: `${PREFIX}event`, startsAt: new Date() });

    signInAs(vicePresident);
    expect((await request(app).patch("/api/budget").send({ budgetCents: 9_000_000 })).status).toBe(
      403,
    );

    signInAs(treasurer);
    const changed = await request(app).patch("/api/budget").send({ budgetCents: 9_000_000 });
    expect(changed.status).toBe(200);
    expect((await db.select().from(settings).where(eq(settings.id, 1)))[0]?.budgetCents).toBe(
      9_000_000,
    );
    expect(
      (
        await request(app)
          .put(`/api/budget/allocations/${eventId}`)
          .send({ allocationCents: 75_000 })
      ).status,
    ).toBe(200);
    expect((await db.select().from(events).where(eq(events.id, eventId)))[0]?.allocationCents).toBe(
      75_000,
    );

    signInAs(officer);
    const summary = await request(app).get("/api/budget");
    expect(summary.status).toBe(200);
    expect(summary.body.budget.allocations).toContainEqual(
      expect.objectContaining({ eventId, allocationCents: 75_000 }),
    );
  });

  it("includes per-event spend even when the event has no allocation", async () => {
    const officer = await member("officer", "officer");
    const eventId = newId();
    await db
      .insert(events)
      .values({ id: eventId, title: `${PREFIX}unallocated`, startsAt: new Date() });
    await db.insert(expenses).values({
      id: newId(),
      eventId,
      description: `${PREFIX}paid`,
      amountCents: 900,
      category: "other",
      status: "paid",
      decidedAt: new Date(),
      paidAt: new Date(),
    });

    signInAs(officer);
    const response = await request(app).get("/api/budget");
    expect(response.status).toBe(200);
    expect(response.body.budget.allocations).toContainEqual(
      expect.objectContaining({
        eventId,
        allocationCents: 0,
        committedCents: 900,
        spentCents: 900,
      }),
    );
  });
});
