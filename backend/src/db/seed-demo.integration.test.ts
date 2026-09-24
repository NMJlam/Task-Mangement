// Side-effect import, and it MUST stay first: `sourceUrl` below is read at module
// scope, and this is the one integration file that reaches the env without going
// through `client.ts`/`app.ts`. CI exports DATABASE_URL as a real variable, so
// only a local `npm run test:integration` ever needed the repo-root `.env`.
import "../config/load-env.js";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "../../..");
const sourceUrl = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;

describe("production demo seed", () => {
  const database = `ctp_seed_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool;
  let db: Pool;
  let testUrl: string;
  let databaseCreated = false;

  const seededCounts = () =>
    db.query<{
      members: number;
      teams: number;
      teamMembers: number;
      events: number;
      workstreams: number;
      tasks: number;
      expenses: number;
      channels: number;
      channelMembers: number;
      messages: number;
      notifications: number;
      auditRows: number;
      aiRuns: number;
      invites: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM app_user) AS members,
        (SELECT count(*)::int FROM team) AS teams,
        (SELECT count(*)::int FROM team_member) AS "teamMembers",
        (SELECT count(*)::int FROM event) AS events,
        (SELECT count(*)::int FROM workstream) AS workstreams,
        (SELECT count(*)::int FROM task) AS tasks,
        (SELECT count(*)::int FROM expense) AS expenses,
        (SELECT count(*)::int FROM channel) AS channels,
        (SELECT count(*)::int FROM chan_member) AS "channelMembers",
        (SELECT count(*)::int FROM message) AS messages,
        (SELECT count(*)::int FROM notification) AS notifications,
        (SELECT count(*)::int FROM audit_log) AS "auditRows",
        (SELECT count(*)::int FROM ai_run) AS "aiRuns",
        (SELECT count(*)::int FROM invite) AS invites
    `);

  const runProductionDemoScript = async (script: "db:migrate" | "db:seed") => {
    await exec("npm", ["run", script], {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: testUrl,
        DATABASE_URL_POOLED: testUrl,
        NODE_ENV: "production",
        SEED_DEMO: "1",
        FOUNDER_EMAIL: " Nathan.Lam.RT@gmail.com ",
        DEMO_DIRECTOR_EMAILS: "reviewer@example.com, NATHAN.LAM.RT@GMAIL.COM, reviewer@example.com",
      },
    });
  };

  beforeAll(async () => {
    if (!sourceUrl) throw new Error("DATABASE_URL is required for integration tests.");
    const adminUrl = new URL(sourceUrl);
    adminUrl.pathname = "/postgres";
    const databaseUrl = new URL(sourceUrl);
    databaseUrl.pathname = `/${database}`;
    testUrl = databaseUrl.toString();
    admin = new Pool({ connectionString: adminUrl.toString() });
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    databaseCreated = true;
    db = new Pool({ connectionString: testUrl });
    await runProductionDemoScript("db:migrate");
    await db.query(`INSERT INTO settings (id, budget_cents) VALUES (1, 0)`);
    await db.query(
      `INSERT INTO invite (id, email, role, expires_at) VALUES ($1, $2, 'director', now() + interval '8 days')`,
      [randomUUID(), "nathan.lam.rt@gmail.com"],
    );
  }, 120_000);

  afterAll(async () => {
    await db?.end();
    if (admin && databaseCreated) {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        [database],
      );
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    }
    await admin?.end();
  });

  it("is renewable, complete, and insert-only across reruns", async () => {
    await runProductionDemoScript("db:seed");

    const invites = await db.query<{ email: string; role: string; days: number }>(`
      SELECT email, role, (EXTRACT(EPOCH FROM (expires_at - now())) / 86400)::float8 AS days
      FROM invite
      WHERE email IN ('nathan.lam.rt@gmail.com', 'reviewer@example.com')
        AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
      ORDER BY email
    `);
    expect(invites.rows).toEqual([
      expect.objectContaining({ email: "nathan.lam.rt@gmail.com", role: "president" }),
      expect.objectContaining({ email: "reviewer@example.com", role: "director" }),
    ]);
    expect(invites.rows.every(({ days }) => days > 6.9 && days <= 7)).toBe(true);

    const personas = await db.query<{ name: string; email: string }>(`
      SELECT account.name, account.email
      FROM app_user member
      JOIN auth."user" account ON account.id = member.auth_user_id
      WHERE account.email LIKE '%@demo.invalid'
    `);
    expect(personas.rows).toHaveLength(6);
    expect(personas.rows.every(({ name }) => name.includes(" "))).toBe(true);
    expect(
      (await db.query<{ budget: number }>(`SELECT budget_cents::int AS budget FROM settings`)).rows,
    ).toEqual([{ budget: 1_000_000 }]);

    const coverage = await db.query<{
      teams: number;
      eventStatuses: string[];
      taskStatuses: string[];
      taskPriorities: string[];
    }>(`
      SELECT
        (SELECT count(*)::int FROM team) AS teams,
        (SELECT array_agg(DISTINCT status ORDER BY status) FROM event) AS "eventStatuses",
        (SELECT array_agg(DISTINCT status ORDER BY status) FROM task) AS "taskStatuses",
        (SELECT array_agg(DISTINCT priority ORDER BY priority) FROM task) AS "taskPriorities"
    `);
    expect(coverage.rows[0]).toEqual({
      teams: 5,
      eventStatuses: ["live", "planning", "wrapped"],
      taskStatuses: ["blocked", "done", "in_progress", "todo"],
      taskPriorities: ["high", "low", "medium", "urgent"],
    });

    const edited = await db.query<{ id: string }>(`
      UPDATE event SET title = 'Edited Gala' WHERE title = 'End of Year Gala' RETURNING id
    `);
    await db.query(`UPDATE settings SET budget_cents = 2000000`);
    const before = (await seededCounts()).rows[0];
    expect(before).toEqual({
      members: 6,
      teams: 5,
      teamMembers: 11,
      events: 3,
      workstreams: 5,
      tasks: 9,
      expenses: 30,
      channels: 11,
      channelMembers: 7,
      messages: 6,
      notifications: 6,
      auditRows: 3,
      aiRuns: 1,
      invites: 6,
    });

    await runProductionDemoScript("db:seed");

    expect(
      (
        await db.query<{ title: string }>("SELECT title FROM event WHERE id = $1", [
          edited.rows[0]!.id,
        ])
      ).rows[0]?.title,
    ).toBe("Edited Gala");
    expect((await seededCounts()).rows[0]).toEqual(before);
    expect(
      (await db.query<{ budget: number }>(`SELECT budget_cents::int AS budget FROM settings`)).rows,
    ).toEqual([{ budget: 2_000_000 }]);

    await db.query(`
      UPDATE invite SET expires_at = now() - interval '1 day'
      WHERE email = 'reviewer@example.com' AND revoked_at IS NULL
    `);
    await runProductionDemoScript("db:seed");
    const renewed = await db.query<{ total: number; live: number }>(`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (
          WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        )::int AS live
      FROM invite WHERE email = 'reviewer@example.com'
    `);
    expect(renewed.rows).toEqual([{ total: 2, live: 1 }]);
  }, 120_000);
});
