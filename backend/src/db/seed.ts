import "../config/load-env.js";
import { createHash } from "node:crypto";
import { nodeDb } from "./client.js";
import { events, tasks, teamMembers, teams, users } from "./schema/index.js";

/**
 * Deterministic, idempotent seed (§4.1) so demos and UAT resets are
 * reproducible. "Idempotent" means safe to run twice: every row has a fixed,
 * deterministic UUID and we `onConflictDoNothing` — no truncate-and-insert.
 *
 * Volumes match the proposal: ~5 users across 3 roles, 3 teams, 6 events,
 * 30 tasks.
 */

/** Deterministic UUID (v5-style) derived from a stable name — no external dep. */
function uuidFor(name: string): string {
  const h = createHash("sha1").update(`ctp-seed:${name}`).digest("hex");
  // Force version 5 and RFC-4122 variant bits.
  const v = h.slice(0, 32).split("");
  v[12] = "5";
  v[16] = ((parseInt(v[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = v.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

const roles = ["admin", "leader", "leader", "member", "member"] as const;

async function seed() {
  const db = nodeDb();

  const userRows = roles.map((role, i) => ({
    id: uuidFor(`user-${i}`),
    googleSub: `seed-sub-${i}`,
    email: `user${i}@example.com`,
    name: `Seed User ${i}`,
    role,
  }));

  const teamRows = Array.from({ length: 3 }, (_, i) => ({
    id: uuidFor(`team-${i}`),
    name: `Team ${i + 1}`,
  }));

  // Every user in every team keeps membership simple and deterministic.
  const memberRows = teamRows.flatMap((team) =>
    userRows.map((user) => ({ teamId: team.id, userId: user.id })),
  );

  const dayMs = 24 * 60 * 60 * 1000;
  const eventRows = Array.from({ length: 6 }, (_, i) => {
    const start = new Date(Date.UTC(2026, 0, 1) + i * dayMs);
    return {
      id: uuidFor(`event-${i}`),
      teamId: teamRows[i % teamRows.length]!.id,
      title: `Seed Event ${i + 1}`,
      startsAt: start,
      endsAt: new Date(start.getTime() + 60 * 60 * 1000),
    };
  });

  const statuses = ["todo", "in_progress", "done"] as const;
  const taskRows = Array.from({ length: 30 }, (_, i) => ({
    id: uuidFor(`task-${i}`),
    teamId: teamRows[i % teamRows.length]!.id,
    title: `Seed Task ${i + 1}`,
    status: statuses[i % statuses.length]!,
    assigneeId: userRows[i % userRows.length]!.id,
  }));

  await db.insert(users).values(userRows).onConflictDoNothing();
  await db.insert(teams).values(teamRows).onConflictDoNothing();
  await db.insert(teamMembers).values(memberRows).onConflictDoNothing();
  await db.insert(events).values(eventRows).onConflictDoNothing();
  await db.insert(tasks).values(taskRows).onConflictDoNothing();

  console.log(
    `✅ seeded ${userRows.length} users, ${teamRows.length} teams, ${eventRows.length} events, ${taskRows.length} tasks`,
  );
}

await seed();
process.exit(0);
