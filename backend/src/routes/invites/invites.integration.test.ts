import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import app from "../../app.js";
import { closeNodeDb, nodeDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { invites } from "../../db/schema/index.js";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("../../auth/auth.js", () => ({ auth: { api: { getSession }, handler: vi.fn() } }));

const db = nodeDb();
const email = "invite-integration@example.com";

beforeAll(async () => {
  await db.delete(invites).where(eq(invites.email, email));
});

afterAll(async () => {
  await db.delete(invites).where(eq(invites.email, email));
  await closeNodeDb();
});

it("rejects inviting a role above the actor tier", async () => {
  getSession.mockResolvedValue({
    user: { id: "seed-director", email: "director@example.com" },
  });

  const response = await request(app).post("/api/invites").send({
    email: "new-president@example.com",
    role: "president",
  });

  expect(response.status).toBe(403);
});

it("creates a lower-tier invite", async () => {
  getSession.mockResolvedValue({
    user: { id: "seed-director", email: "director@example.com" },
  });

  const response = await request(app).post("/api/invites").send({
    email: email.toUpperCase(),
    role: "officer",
  });

  expect(response.status).toBe(201);
  expect(response.body.invite).toMatchObject({
    email,
    role: "officer",
    expiresAt: null,
    status: "pending",
  });
  expect(await db.select().from(invites).where(eq(invites.email, email))).toHaveLength(1);
});

it("rejects a role without the invite capability, whatever its tier", async () => {
  // Tier 2 clears both tier checks for an officer invite, so only can() can refuse.
  getSession.mockResolvedValue({
    user: { id: "seed-vice_president", email: "vice_president@example.com" },
  });

  const response = await request(app).post("/api/invites").send({
    email,
    role: "officer",
  });

  expect(response.status).toBe(403);
  expect(response.body.error.code).toBe("FORBIDDEN");
});

it("lists pending invites at or below the actor tier", async () => {
  const hidden = { id: newId(), email, role: "president" as const };
  await db.insert(invites).values(hidden);
  getSession.mockResolvedValue({
    user: { id: "seed-director", email: "director@example.com" },
  });

  const response = await request(app).get("/api/invites");

  expect(response.status).toBe(200);
  const mine = response.body.invites.filter((invite: { email: string }) => invite.email === email);
  expect(mine).toEqual([expect.objectContaining({ role: "officer", status: "pending" })]);
});

it("revokes a pending invite once, and hides one above the actor tier", async () => {
  getSession.mockResolvedValue({
    user: { id: "seed-director", email: "director@example.com" },
  });
  const rows = await db.select().from(invites).where(eq(invites.email, email));
  const officer = rows.find((row) => row.role === "officer")!;
  const president = rows.find((row) => row.role === "president")!;

  expect((await request(app).delete(`/api/invites/${president.id}`)).status).toBe(404);
  expect((await request(app).delete(`/api/invites/${officer.id}`)).status).toBe(204);
  expect((await request(app).delete(`/api/invites/${officer.id}`)).status).toBe(404);

  const [stored] = await db.select().from(invites).where(eq(invites.id, officer.id));
  expect(stored!.revokedAt).not.toBeNull();

  const listed = (await request(app).get("/api/invites")).body.invites as { id: string }[];
  expect(listed.map((invite) => invite.id)).not.toContain(officer.id);
});

it("refuses listing and revoking without the invite capability", async () => {
  getSession.mockResolvedValue({
    user: { id: "seed-vice_president", email: "vice_president@example.com" },
  });

  expect((await request(app).get("/api/invites")).status).toBe(403);
  expect((await request(app).delete(`/api/invites/${newId()}`)).status).toBe(403);
});
