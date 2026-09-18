import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app.js";
import { closeNodeDb, nodeDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { appUsers, expenses } from "../../db/schema/index.js";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("../../auth/auth.js", () => ({ auth: { api: { getSession }, handler: vi.fn() } }));

const PREFIX = "test-finance-";

describe("finance routes (integration)", () => {
  const db = nodeDb();

  async function member(
    name: string,
    role: "president" | "treasurer" | "vice_president" | "officer",
  ) {
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
    await db.execute(sql`
      DELETE FROM "notification" WHERE "user_id" IN (
        SELECT id FROM "app_user" WHERE "auth_user_id" LIKE ${`${PREFIX}%`}
      ) OR "entity_id" IN (
        SELECT id FROM "expense" WHERE description LIKE ${`${PREFIX}%`}
      )
    `);
    await db.execute(sql`DELETE FROM "expense" WHERE description LIKE ${`${PREFIX}%`}`);
    await db.execute(sql`DELETE FROM "event" WHERE title LIKE ${`${PREFIX}%`}`);
    await db.execute(sql`DELETE FROM "app_user" WHERE "auth_user_id" LIKE ${`${PREFIX}%`}`);
    await db.execute(sql`DELETE FROM auth."user" WHERE id LIKE ${`${PREFIX}%`}`);
  }

  beforeEach(async () => {
    getSession.mockReset();
    await clean();
  });

  afterAll(async () => {
    await clean();
    await closeNodeDb();
  });

  it("guards the full pending to approved to paid lifecycle", async () => {
    const treasurer = await member("treasurer", "treasurer");
    const president = await member("president", "president");

    signInAs(treasurer);
    const created = await request(app)
      .post("/api/expenses")
      .send({
        description: `${PREFIX}venue deposit`,
        amountCents: 12_500,
        category: "venue",
      });
    expect(created.status).toBe(201);
    const id = created.body.expense.id as string;
    expect((await db.select().from(expenses).where(eq(expenses.id, id)))[0]).toMatchObject({
      status: "pending",
      submitter: treasurer.id,
    });

    expect(
      (await request(app).post(`/api/expenses/${id}/decision`).send({ action: "approve" })).status,
    ).toBe(422);

    signInAs(president);
    const approved = await request(app)
      .post(`/api/expenses/${id}/decision`)
      .send({ action: "approve" });
    expect(approved.status).toBe(200);
    expect(approved.body.expense.status).toBe("approved");

    expect(
      (
        await request(app)
          .patch(`/api/expenses/${id}`)
          .send({ description: `${PREFIX}changed too late` })
      ).status,
    ).toBe(409);

    signInAs(treasurer);
    const paid = await request(app)
      .post(`/api/expenses/${id}/decision`)
      .send({ action: "mark_paid" });
    expect(paid.status).toBe(200);
    expect(paid.body.expense.status).toBe("paid");
    expect(paid.body.budget.spentCents).toBeGreaterThanOrEqual(12_500);
    expect((await db.select().from(expenses).where(eq(expenses.id, id)))[0]?.status).toBe("paid");
  });

  it("updates and deletes only pending expenses", async () => {
    const treasurer = await member("treasurer", "treasurer");
    signInAs(treasurer);
    const create = (description: string) =>
      request(app).post("/api/expenses").send({
        description,
        amountCents: 500,
        category: "other",
      });
    const first = await create(`${PREFIX}edit me`);
    const second = await create(`${PREFIX}delete me`);

    const updated = await request(app)
      .patch(`/api/expenses/${first.body.expense.id}`)
      .send({ amountCents: 750 });
    expect(updated.status).toBe(200);
    expect(updated.body.expense.amountCents).toBe(750);
    expect(
      (await db.select().from(expenses).where(eq(expenses.id, first.body.expense.id)))[0]
        ?.amountCents,
    ).toBe(750);

    expect((await request(app).delete(`/api/expenses/${second.body.expense.id}`)).status).toBe(204);
    expect(
      await db.select().from(expenses).where(eq(expenses.id, second.body.expense.id)),
    ).toHaveLength(0);
  });

  it("shows general members only their own claims plus approved spend", async () => {
    const officer = await member("officer", "officer");
    const president = await member("president", "president");
    await db.insert(expenses).values([
      {
        id: newId(),
        description: `${PREFIX}own pending`,
        amountCents: 100,
        category: "other",
        submitter: officer.id,
      },
      {
        id: newId(),
        description: `${PREFIX}other pending`,
        amountCents: 200,
        category: "printing",
        submitter: president.id,
      },
      {
        id: newId(),
        description: `${PREFIX}approved`,
        amountCents: 300,
        category: "marketing",
        status: "approved",
        submitter: president.id,
        decider: officer.id,
        decidedAt: new Date(),
      },
    ]);

    signInAs(officer);
    const response = await request(app).get("/api/expenses");
    expect(response.status).toBe(200);
    expect(
      response.body.expenses.map((expense: { description: string }) => expense.description),
    ).toEqual(expect.arrayContaining([`${PREFIX}own pending`, `${PREFIX}approved`]));
    expect(response.body.expenses).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ description: `${PREFIX}other pending` })]),
    );
  });
});
