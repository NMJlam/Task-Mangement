import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, expect, it, vi } from "vitest";
import app from "../../app.js";
import { closeNodeDb, nodeDb } from "../../db/client.js";
import { invites } from "../../db/schema/index.js";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("../../auth/auth.js", () => ({ auth: { api: { getSession }, handler: vi.fn() } }));

const db = nodeDb();
const email = "invite-integration@example.com";

afterAll(async () => {
  await db.delete(invites).where(eq(invites.email, email));
  await closeNodeDb();
});

it("rejects inviting a role above the actor tier", async () => {
  getSession.mockResolvedValue({
    user: { id: "seed-marketing_director", email: "marketing_director@example.com" },
  });

  const response = await request(app)
    .post("/api/invites")
    .send({
      email: "new-president@example.com",
      role: "president",
      expiresAt: new Date(Date.now() + 60_000),
    });

  expect(response.status).toBe(403);
});

it("creates a lower-tier invite", async () => {
  getSession.mockResolvedValue({
    user: { id: "seed-marketing_director", email: "marketing_director@example.com" },
  });

  const response = await request(app)
    .post("/api/invites")
    .send({
      email: email.toUpperCase(),
      role: "officer",
      expiresAt: new Date(Date.now() + 60_000),
    });

  expect(response.status).toBe(201);
  expect(response.body.invite).toMatchObject({ email, role: "officer", status: "pending" });
  expect(await db.select().from(invites).where(eq(invites.email, email))).toHaveLength(1);
});
