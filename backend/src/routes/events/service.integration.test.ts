import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeNodeDb, nodeDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { events, expenses, settings } from "../../db/schema/index.js";
import { allocateToEvent, BudgetExceededError, releaseAllocation } from "./service.js";

const db = nodeDb();

let originalBudgetCents = 0;
const eventA = newId();
const eventB = newId();
const releaseEventId = newId();

beforeAll(async () => {
  const [row] = await db.select({ budgetCents: settings.budgetCents }).from(settings);
  originalBudgetCents = row?.budgetCents ?? 0;

  // Other events (demo-seeded or otherwise) already hold their own slice of
  // the pool — allocateToEvent sums ALL non-cancelled events, deliberately,
  // so the club-wide total is what actually gets guarded. Size the budget
  // relative to that existing total rather than a fixed number, so this test
  // gives itself exactly 1000 cents of real headroom regardless of what else
  // is in the database.
  const [existing] = await db
    .select({ total: sql<number>`COALESCE(SUM(allocation_cents), 0)` })
    .from(events)
    .where(sql`status <> 'cancelled'`);
  const headroom = Number(existing?.total ?? 0) + 1000;
  await db.update(settings).set({ budgetCents: headroom, updatedAt: new Date() });

  await db.insert(events).values([
    { id: eventA, title: "Concurrent allocation A", startsAt: new Date() },
    { id: eventB, title: "Concurrent allocation B", startsAt: new Date() },
    { id: releaseEventId, title: "Cancel releases allocation", startsAt: new Date() },
  ]);
});

afterAll(async () => {
  await db.delete(expenses).where(eq(expenses.eventId, releaseEventId));
  await db.delete(events).where(eq(events.id, eventA));
  await db.delete(events).where(eq(events.id, eventB));
  await db.delete(events).where(eq(events.id, releaseEventId));
  await db.update(settings).set({ budgetCents: originalBudgetCents, updatedAt: new Date() });
  await closeNodeDb();
});

describe("allocateToEvent (Rule 1)", () => {
  it("locks the settings row so two concurrent allocations cannot both overspend the pool", async () => {
    const results = await Promise.allSettled([
      db.transaction((tx) => allocateToEvent(tx, eventA, 700)),
      db.transaction((tx) => allocateToEvent(tx, eventB, 700)),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BudgetExceededError);

    // The FOR UPDATE lock, not luck: without it both reads would see the same
    // "0 already allocated" and both writes would land.
    const rows = await db
      .select({ allocationCents: events.allocationCents })
      .from(events)
      .where(sql`${events.id} IN (${eventA}, ${eventB})`);
    const total = rows.reduce((sum, r) => sum + r.allocationCents, 0);
    expect(total).toBe(700);
  });
});

describe("releaseAllocation (Rule 2)", () => {
  it("releases the unspent allocation down to committed spend, not to zero", async () => {
    await db.update(events).set({ allocationCents: 500 }).where(eq(events.id, releaseEventId));
    await db.insert(expenses).values([
      {
        id: newId(),
        eventId: releaseEventId,
        amountCents: 200,
        description: "Approved deposit",
        category: "venue",
        status: "approved",
        decidedAt: new Date(),
      },
      {
        id: newId(),
        eventId: releaseEventId,
        amountCents: 100,
        description: "Still pending",
        category: "catering",
        status: "pending",
      },
    ]);

    await db.transaction((tx) => releaseAllocation(tx, releaseEventId));

    const [row] = await db
      .select({ allocationCents: events.allocationCents })
      .from(events)
      .where(eq(events.id, releaseEventId));
    // The 200 already committed stays allocated; the pending 100 (not yet
    // committed) and the rest of the original 500 both go back to the pool.
    expect(row?.allocationCents).toBe(200);
  });
});
