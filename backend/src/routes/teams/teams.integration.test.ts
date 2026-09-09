import type { Role } from "@ctp/shared";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app.js";
import { closeNodeDb, nodeDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { expenses, teamMembers, teams } from "../../db/schema/index.js";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("../../auth/auth.js", () => ({ auth: { api: { getSession }, handler: vi.fn() } }));

/**
 * Every fixture is prefixed so cleanup can never touch the base seed — CI runs
 * `db:seed` before this tier and `members.integration.test.ts` asserts against
 * those rows (see seed-demo.ts).
 */
const PREFIX = "test-teams-";

describe("/api/teams (integration)", () => {
  const db = nodeDb();

  async function member(name: string, role: Role) {
    const authUserId = `${PREFIX}${name}`;
    await db.execute(sql`
      INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${authUserId}, ${name}, ${`${authUserId}@example.com`}, true, now(), now())
    `);
    const id = newId();
    await db.execute(sql`
      INSERT INTO "app_user" ("id", "auth_user_id", "role") VALUES (${id}, ${authUserId}, ${role})
    `);
    return { id, authUserId };
  }

  async function team(name: string, lead?: string) {
    const [row] = await db
      .insert(teams)
      .values({ id: newId(), name: `${PREFIX}${name}`, lead: lead ?? null })
      .returning();
    return row!;
  }

  function signIn(actor: { authUserId: string }) {
    getSession.mockResolvedValue({
      user: { id: actor.authUserId, email: `${actor.authUserId}@example.com` },
    });
  }

  async function cleanup() {
    // Expenses hold a RESTRICT reference to team, so they go first — the same
    // ordering the DELETE route reports as 409 TEAM_IN_USE.
    await db.execute(
      sql`DELETE FROM "expense" WHERE "team_id" IN (SELECT "id" FROM "team" WHERE "name" LIKE ${`${PREFIX}%`})`,
    );
    await db.execute(sql`DELETE FROM "team" WHERE "name" LIKE ${`${PREFIX}%`}`);
    await db.execute(sql`DELETE FROM "app_user" WHERE "auth_user_id" LIKE ${`${PREFIX}%`}`);
    await db.execute(sql`DELETE FROM auth."user" WHERE "id" LIKE ${`${PREFIX}%`}`);
  }

  beforeEach(async () => {
    getSession.mockReset();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await closeNodeDb();
  });

  it("lists teams with their members and filters by member", async () => {
    const officer = await member("officer", "officer");
    const staffed = await team("staffed");
    const empty = await team("empty");
    await db.insert(teamMembers).values({ teamId: staffed.id, userId: officer.id });
    signIn(officer);

    const all = await request(app).get("/api/teams");
    expect(all.status).toBe(200);
    const listed = all.body.teams.filter((t: { name: string }) => t.name.startsWith(PREFIX));
    expect(listed).toHaveLength(2);
    expect(listed.find((t: { id: string }) => t.id === staffed.id).memberIds).toEqual([officer.id]);
    expect(listed.find((t: { id: string }) => t.id === empty.id).memberIds).toEqual([]);

    const mine = await request(app).get(`/api/teams?member=${officer.id}`);
    expect(mine.status).toBe(200);
    expect(mine.body.teams.map((t: { id: string }) => t.id)).toEqual([staffed.id]);
  });

  it("refuses team creation below management tier", async () => {
    signIn(await member("director", "director"));

    const response = await request(app)
      .post("/api/teams")
      .send({ name: `${PREFIX}new` });

    expect(response.status).toBe(403);
  });

  it("creates a team and rejects a duplicate name", async () => {
    signIn(await member("president", "president"));

    const created = await request(app)
      .post("/api/teams")
      .send({ name: `${PREFIX}media` });
    expect(created.status).toBe(201);
    expect(created.body.team.memberIds).toEqual([]);

    const duplicate = await request(app)
      .post("/api/teams")
      .send({ name: `${PREFIX}media` });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("TEAM_NAME_TAKEN");
  });

  it("rejects a lead that is not a member", async () => {
    signIn(await member("president", "president"));

    const response = await request(app)
      .post("/api/teams")
      .send({ name: `${PREFIX}orphan`, lead: newId() });

    expect(response.status).toBe(422);
    expect(response.body.error.fields.lead).toBeDefined();
  });

  it("renames a team", async () => {
    signIn(await member("president", "president"));
    const existing = await team("before");

    const response = await request(app)
      .patch(`/api/teams/${existing.id}`)
      .send({ name: `${PREFIX}after` });

    expect(response.status).toBe(200);
    expect(response.body.team.name).toBe(`${PREFIX}after`);
  });

  it("refuses to delete a team with recorded spend, but deletes a free one", async () => {
    signIn(await member("president", "president"));
    const spent = await team("spent");
    const free = await team("free");
    await db.insert(expenses).values({
      id: newId(),
      teamId: spent.id,
      amountCents: 1000,
      description: "fixture",
      category: "catering",
    });

    const blocked = await request(app).delete(`/api/teams/${spent.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("TEAM_IN_USE");

    const deleted = await request(app).delete(`/api/teams/${free.id}`);
    expect(deleted.status).toBe(204);
  });

  it("lets a lead staff their own team but not another", async () => {
    const lead = await member("lead", "director");
    const officer = await member("officer", "officer");
    const own = await team("own", lead.id);
    const other = await team("other");
    signIn(lead);

    const allowed = await request(app).put(`/api/teams/${own.id}/members/${officer.id}`);
    expect(allowed.status).toBe(204);

    const refused = await request(app).put(`/api/teams/${other.id}/members/${officer.id}`);
    expect(refused.status).toBe(403);
  });

  it("adds and removes a member idempotently", async () => {
    const president = await member("president", "president");
    const officer = await member("officer", "officer");
    const target = await team("staffing");
    signIn(president);

    for (const _ of [1, 2]) {
      expect((await request(app).put(`/api/teams/${target.id}/members/${officer.id}`)).status).toBe(
        204,
      );
    }
    const links = await db.select().from(teamMembers);
    expect(links.filter((link) => link.teamId === target.id)).toHaveLength(1);

    for (const _ of [1, 2]) {
      expect(
        (await request(app).delete(`/api/teams/${target.id}/members/${officer.id}`)).status,
      ).toBe(204);
    }
  });

  it("rejects staffing with a member that does not exist", async () => {
    signIn(await member("president", "president"));
    const target = await team("unknown-member");

    const response = await request(app).put(`/api/teams/${target.id}/members/${newId()}`);

    expect(response.status).toBe(422);
    expect(response.body.error.fields.userId).toBeDefined();
  });
});
