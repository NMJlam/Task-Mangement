import { createHash } from "node:crypto";
import type { Role } from "@ctp/shared";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { nodeDb } from "./client.js";
import {
  aiRuns,
  appUsers,
  auditLog,
  chanMembers,
  channels,
  events,
  expenses,
  invites,
  messages,
  notifications,
  tasks,
  teamMembers,
  teams,
  workstreams,
} from "./schema/index.js";

/**
 * Optional demo fixture — every table the base seed leaves empty.
 *
 * WHY THIS IS OPT-IN. CI runs `db:migrate && db:seed` before the integration
 * tier (.github/workflows/ci.yml), so whatever the default seed writes IS the
 * shared test fixture. members.integration.test.ts depends on `seed-treasurer`
 * being the ONLY treasurer to assert its 409 ROLE_VACANCY, so widening the
 * default seed would break the suite. Set SEED_DEMO=1 to load this instead:
 *
 *   SEED_DEMO=1 npm run db:seed
 *
 * Locally it reuses the six role fixtures the base seed creates, so those tests
 * still hold with demo data loaded. Production gets deterministic fictional
 * display members with .invalid emails; they cannot sign in.
 *
 * Idempotent like the rest: every id is derived from a slug (see `demoId`) and
 * every insert is ON CONFLICT DO NOTHING, so a second run changes nothing.
 */

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const now = Date.now();

export function demoInvitees(
  founderEmail: string | undefined,
  directorEmails: string | undefined,
): { email: string; role: "president" | "director" }[] {
  const founder = founderEmail?.trim().toLowerCase();
  if (!founder) throw new Error("FOUNDER_EMAIL is required for the production bootstrap seed.");

  const emails = [founder, ...(directorEmails?.split(",") ?? [])]
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const invalid = emails.filter((email) => !z.email().safeParse(email).success);
  if (invalid.length) throw new Error(`Invalid demo email address(es): ${invalid.join(", ")}`);

  return [...new Set(emails)].map((email) => ({
    email,
    role: email === founder ? "president" : "director",
  }));
}

/** A date `days` from now — negative is the past. */
const at = (days: number, extraHours = 0): Date => new Date(now + days * DAY + extraHours * HOUR);

/**
 * A stable UUID for a demo row, derived from its slug.
 *
 * Deterministic ids are what make this seed re-runnable: the primary key is
 * known before the insert, so ON CONFLICT DO NOTHING turns a second run into a
 * no-op instead of a duplicate fixture. Shaped as a v5 UUID; real rows keep
 * using `newId()` (v7).
 */
function demoId(slug: string): string {
  const h = createHash("sha1").update(`ctp-demo:${slug}`).digest("hex");
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

const DEMO_MEMBERS = [
  { role: "president", name: "Ava Chen" },
  { role: "vice_president", name: "Liam Brooks" },
  { role: "treasurer", name: "Priya Nair" },
  { role: "secretary", name: "Zoe Martin" },
  { role: "director", name: "Ethan Nguyen" },
  { role: "officer", name: "Maya Singh" },
] as const satisfies readonly { role: Role; name: string }[];

// Exec is management (tier 2) plus directors, led by the president. It is a
// team, not a rank — see docs/roles-and-permissions.md "Groups".
const TEAMS = [
  { slug: "exec", name: "Exec", lead: "president" },
  { slug: "media", name: "Media", lead: "director" },
  { slug: "marketing", name: "Marketing", lead: "vice_president" },
  { slug: "sponsorship", name: "Sponsorship", lead: "treasurer" },
  { slug: "events", name: "Events", lead: "secretary" },
] as const satisfies readonly { slug: string; name: string; lead: Role }[];

export async function seedDemo(production = false): Promise<void> {
  const db = nodeDb();

  if (production) {
    for (const persona of DEMO_MEMBERS) {
      await db.execute(sql`
        INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
        VALUES (
          ${`demo-persona-${persona.role}`},
          ${persona.name},
          ${`${persona.role.replaceAll("_", ".")}@demo.invalid`},
          false,
          ${new Date(now)},
          ${new Date(now)}
        )
        ON CONFLICT (id) DO NOTHING
      `);
    }
    await db
      .insert(appUsers)
      .values(
        DEMO_MEMBERS.map(({ role }) => ({
          id: demoId(`member:${role}`),
          authUserId: `demo-persona-${role}`,
          role,
        })),
      )
      .onConflictDoNothing();
  }

  // The base seed generates app_user ids with newId(), so they cannot be
  // hardcoded here — look them up by the role they hold.
  const roster = production
    ? DEMO_MEMBERS.map(({ role }) => ({ id: demoId(`member:${role}`), role }))
    : await db.select({ id: appUsers.id, role: appUsers.role }).from(appUsers);
  const byRole = new Map<Role, string>(roster.map((row) => [row.role, row.id]));
  const member = (role: Role): string => {
    const id = byRole.get(role);
    if (!id) {
      throw new Error(`SEED_DEMO needs a '${role}' display member. Run the base seed first.`);
    }
    return id;
  };

  const team = (slug: (typeof TEAMS)[number]["slug"]): string => demoId(`team:${slug}`);
  const event = (slug: string): string => demoId(`event:${slug}`);
  const channel = (slug: string): string => demoId(`channel:${slug}`);
  const task = (slug: string): string => demoId(`task:${slug}`);
  const message = (slug: string): string => demoId(`message:${slug}`);

  // Upgrade an untouched base seed once, then preserve every later budget edit.
  await db.execute(sql`
    UPDATE "settings"
    SET "budget_cents" = 1000000, "updated_at" = ${new Date(now)}
    WHERE "id" = 1
      AND "budget_cents" = 0
      AND NOT EXISTS (
        SELECT 1 FROM "event" WHERE "id" IN (
          ${event("oweek")}, ${event("hackathon")}, ${event("gala")}
        )
      )
  `);

  await db
    .insert(teams)
    .values(TEAMS.map((t) => ({ id: team(t.slug), name: t.name, lead: member(t.lead) })))
    .onConflictDoNothing();

  await db
    .insert(teamMembers)
    .values([
      { teamId: team("exec"), userId: member("president") },
      { teamId: team("exec"), userId: member("vice_president") },
      { teamId: team("exec"), userId: member("treasurer") },
      { teamId: team("exec"), userId: member("secretary") },
      { teamId: team("exec"), userId: member("director") },
      { teamId: team("media"), userId: member("director") },
      { teamId: team("media"), userId: member("officer") },
      { teamId: team("marketing"), userId: member("vice_president") },
      { teamId: team("marketing"), userId: member("officer") },
      { teamId: team("sponsorship"), userId: member("treasurer") },
      { teamId: team("events"), userId: member("secretary") },
      { teamId: team("events"), userId: member("officer") },
    ])
    .onConflictDoNothing();

  // One event per status the lifecycle actually reaches, so any status-filtered
  // view has something to show.
  await db
    .insert(events)
    .values([
      {
        id: event("oweek"),
        title: "O-Week Welcome Night",
        description: "Welcome the new cohort with food, games and club sign-ups.",
        venue: "Great Hall",
        startsAt: at(-45),
        endsAt: at(-45, 5),
        status: "wrapped",
        allocationCents: 120_000,
        attendanceEstimate: 300,
        owner: member("secretary"),
      },
      {
        id: event("hackathon"),
        title: "Semester 2 Hackathon",
        description: "24-hour build event, judged Sunday morning.",
        venue: "Engineering Building, Level 2",
        startsAt: at(3),
        endsAt: at(4),
        status: "live",
        allocationCents: 250_000,
        attendanceEstimate: 150,
        owner: member("director"),
      },
      {
        id: event("gala"),
        title: "End of Year Gala",
        description: "Formal dinner and awards to close out the year.",
        venue: "TBC — pending sponsorship",
        startsAt: at(60),
        endsAt: at(60, 6),
        status: "planning",
        allocationCents: 180_000,
        attendanceEstimate: 120,
        minTier: 1,
        owner: member("president"),
      },
    ])
    .onConflictDoNothing();

  // Every (event_id, team_id) a task below uses must exist here first — task's
  // composite FK `task_within_declared_workstream` points at this table.
  await db
    .insert(workstreams)
    .values([
      {
        id: demoId("ws:oweek-events"),
        eventId: event("oweek"),
        teamId: team("events"),
        brief: "Run the night: venue, furniture, pack-down.",
        lead: member("secretary"),
        dueAt: at(-46),
      },
      {
        id: demoId("ws:hackathon-media"),
        eventId: event("hackathon"),
        teamId: team("media"),
        brief: "Film the keynote and cut a highlight reel within a week.",
        lead: member("director"),
        dueAt: at(6),
      },
      {
        id: demoId("ws:hackathon-marketing"),
        eventId: event("hackathon"),
        teamId: team("marketing"),
        brief: "Announce the lineup and drive signups to 150.",
        lead: member("vice_president"),
        dueAt: at(1),
      },
      {
        id: demoId("ws:hackathon-events"),
        eventId: event("hackathon"),
        teamId: team("events"),
        brief: "Venue, AV and catering on the day.",
        lead: member("secretary"),
        dueAt: at(2),
      },
      {
        id: demoId("ws:gala-sponsorship"),
        eventId: event("gala"),
        teamId: team("sponsorship"),
        brief: "Secure two gold partners before the deck goes out.",
        lead: member("treasurer"),
        dueAt: at(45),
      },
    ])
    .onConflictDoNothing();

  // Both visibility mechanisms are represented: `team`/`event` channels are
  // tier-gated, `group`/`dm`/`ai` are membership-gated and must leave min_tier
  // at 0 (channel_min_tier_only_when_tier_gated_check).
  await db
    .insert(channels)
    .values([
      // Directors are on Exec, so its channel opens at tier 1, not 2.
      { id: channel("exec"), teamId: team("exec"), kind: "team", name: "exec", minTier: 1 },
      { id: channel("media"), teamId: team("media"), kind: "team", name: "media" },
      { id: channel("marketing"), teamId: team("marketing"), kind: "team", name: "marketing" },
      {
        id: channel("sponsorship"),
        teamId: team("sponsorship"),
        kind: "team",
        name: "sponsorship",
        minTier: 1,
      },
      { id: channel("events"), teamId: team("events"), kind: "team", name: "events" },
      {
        id: channel("oweek"),
        eventId: event("oweek"),
        kind: "event",
        name: "oweek-2026",
      },
      {
        id: channel("hackathon"),
        eventId: event("hackathon"),
        kind: "event",
        name: "hackathon-2026",
      },
      {
        id: channel("gala"),
        eventId: event("gala"),
        kind: "event",
        name: "gala-planning",
        minTier: 1,
      },
      { id: channel("committee"), kind: "group", name: "committee-private" },
      { id: channel("assistant"), kind: "ai", name: "assistant" },
      // The one channel allowed an absent name (channel_named_unless_dm_check).
      { id: channel("dm-pres-dir"), kind: "dm" },
    ])
    .onConflictDoNothing();

  await db
    .insert(chanMembers)
    .values([
      { channelId: channel("committee"), userId: member("president"), lastReadAt: at(-1) },
      { channelId: channel("committee"), userId: member("vice_president"), lastReadAt: at(-2) },
      { channelId: channel("committee"), userId: member("treasurer"), lastReadAt: at(-3) },
      { channelId: channel("committee"), userId: member("secretary"), lastReadAt: at(-1) },
      { channelId: channel("dm-pres-dir"), userId: member("president"), lastReadAt: at(-1) },
      { channelId: channel("dm-pres-dir"), userId: member("director"), lastReadAt: at(-4) },
      { channelId: channel("assistant"), userId: member("president"), lastReadAt: at(-1) },
      { channelId: channel("assistant"), userId: member("director"), lastReadAt: at(-2) },
    ])
    .onConflictDoNothing();

  // Inserted before tasks and messages because both carry an ai_run_id.
  await db
    .insert(aiRuns)
    .values([
      {
        id: demoId("airun:breakdown"),
        channelId: channel("assistant"),
        userId: member("president"),
        prompt: "Break the hackathon down into tasks for the media team.",
        steps: [
          { tool: "listWorkstreams", input: { eventId: event("hackathon") }, durationMs: 41 },
          { tool: "createTask", input: { title: "Film the opening keynote" }, durationMs: 87 },
        ],
        costMicroUsd: 4_120,
        createdAt: at(-2),
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(tasks)
    .values([
      {
        id: task("film-keynote"),
        eventId: event("hackathon"),
        teamId: team("media"),
        title: "Film the opening keynote",
        status: "todo",
        priority: "high",
        assignee: member("director"),
        creator: member("president"),
        dueAt: at(3),
        boardOrder: 0,
        // The one line of AI provenance: this task came out of the run above.
        aiRunId: demoId("airun:breakdown"),
      },
      {
        id: task("highlight-reel"),
        eventId: event("hackathon"),
        teamId: team("media"),
        title: "Edit the highlight reel",
        status: "in_progress",
        priority: "medium",
        assignee: member("officer"),
        creator: member("director"),
        dueAt: at(6),
        boardOrder: 1,
      },
      {
        id: task("speaker-lineup"),
        eventId: event("hackathon"),
        teamId: team("marketing"),
        title: "Post the speaker lineup",
        status: "done",
        priority: "high",
        assignee: member("vice_president"),
        creator: member("president"),
        dueAt: at(-1),
        // Required by task_completed_at_matches_status_check when status = done.
        completedAt: at(-1, 3),
        boardOrder: 0,
      },
      {
        id: task("venue-av"),
        eventId: event("hackathon"),
        teamId: team("events"),
        title: "Book the venue AV",
        status: "blocked",
        priority: "urgent",
        assignee: member("secretary"),
        creator: member("president"),
        dueAt: at(1),
        boardOrder: 0,
      },
      {
        id: task("return-furniture"),
        eventId: event("oweek"),
        teamId: team("events"),
        title: "Return the hired furniture",
        status: "done",
        priority: "medium",
        assignee: member("officer"),
        creator: member("secretary"),
        completedAt: at(-40),
        boardOrder: 0,
      },
      {
        id: task("sponsor-deck"),
        eventId: event("gala"),
        teamId: team("sponsorship"),
        title: "Draft the sponsorship deck",
        status: "todo",
        priority: "high",
        assignee: member("treasurer"),
        creator: member("president"),
        dueAt: at(30),
        minTier: 1,
        boardOrder: 0,
      },
      // team_id NULL: event-wide work owned by no single team. MATCH SIMPLE
      // means the composite FK is skipped, so no workstream is required.
      {
        id: task("final-headcount"),
        eventId: event("hackathon"),
        title: "Confirm the final headcount",
        status: "todo",
        priority: "medium",
        assignee: member("secretary"),
        creator: member("vice_president"),
        dueAt: at(2),
        boardOrder: 2,
      },
      // Both parents NULL: standing committee work, the single standing board.
      {
        id: task("constitution"),
        title: "Update the constitution",
        status: "todo",
        priority: "low",
        assignee: member("secretary"),
        creator: member("president"),
        boardOrder: 0,
      },
      // Deliberately overdue, so task_overdue_idx has something to serve.
      {
        id: task("insurance"),
        title: "Renew the club insurance",
        status: "todo",
        priority: "urgent",
        assignee: member("treasurer"),
        creator: member("president"),
        dueAt: at(-5),
        boardOrder: 1,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(messages)
    .values([
      {
        id: message("hack-venue"),
        channelId: channel("hackathon"),
        author: member("president"),
        body: "Venue is locked in for Saturday. Doors at 9, keynote at 10.",
        createdAt: at(-2),
      },
      // One level of threading (rule 11) — a reply to the message above.
      {
        id: message("hack-venue-reply"),
        channelId: channel("hackathon"),
        parentId: message("hack-venue"),
        author: member("director"),
        body: "Great — we will be set up by 9:30 to catch the doors opening.",
        createdAt: at(-2, 1),
      },
      // Points at a task as well as a channel: appears in both the channel and
      // the task drawer.
      {
        id: message("shot-list"),
        channelId: channel("media"),
        taskId: task("film-keynote"),
        author: member("officer"),
        body: "Shot list is drafted — @[assignee] can you sanity-check it before Friday?",
        createdAt: at(-1),
      },
      // All four file columns set together (message_file_all_or_nothing_check).
      {
        id: message("run-sheet"),
        channelId: channel("events"),
        author: member("secretary"),
        body: "Run sheet v3 attached.",
        fileKey: "demo/run-sheet-v3.pdf",
        fileName: "run-sheet-v3.pdf",
        fileSizeBytes: 184_320,
        fileMime: "application/pdf",
        createdAt: at(-1, 2),
      },
      // author NULL + ai_run_id set is what marks a message as model-produced;
      // there is no is_bot flag.
      {
        id: message("assistant-reply"),
        channelId: channel("assistant"),
        aiRunId: demoId("airun:breakdown"),
        body: "I created 1 task for the media team: Film the opening keynote.",
        createdAt: at(-2),
      },
      {
        id: message("dm-hello"),
        channelId: channel("dm-pres-dir"),
        author: member("president"),
        body: "Can you take point on the reel this year?",
        createdAt: at(-4),
      },
    ])
    .onConflictDoNothing();

  // One expense per status, so the treasurer's queue, the ledger and the
  // rejected list all have rows. decider is never the submitter
  // (expense_decider_is_not_submitter_check).
  await db
    .insert(expenses)
    .values([
      {
        id: demoId("expense:catering"),
        eventId: event("hackathon"),
        teamId: team("events"),
        amountCents: 45_000,
        description: "Catering deposit — Saturday lunch for 150",
        category: "catering",
        status: "pending",
        submitter: member("secretary"),
        createdAt: at(-1),
      },
      {
        id: demoId("expense:camera"),
        eventId: event("hackathon"),
        teamId: team("media"),
        amountCents: 32_000,
        description: "Camera and lens rental for the weekend",
        category: "equipment",
        status: "approved",
        submitter: member("director"),
        decider: member("treasurer"),
        decidedAt: at(-1),
        receiptKey: "demo/receipts/camera-rental.jpg",
        createdAt: at(-3),
      },
      {
        id: demoId("expense:marquee"),
        eventId: event("oweek"),
        teamId: team("events"),
        amountCents: 78_000,
        description: "Marquee hire for the welcome night",
        category: "venue",
        status: "paid",
        submitter: member("secretary"),
        decider: member("treasurer"),
        decidedAt: at(-42),
        paidAt: at(-38),
        receiptKey: "demo/receipts/marquee.pdf",
        createdAt: at(-44),
      },
      {
        id: demoId("expense:upgrade"),
        eventId: event("gala"),
        teamId: team("sponsorship"),
        amountCents: 150_000,
        description: "Premium venue upgrade for the gala",
        category: "venue",
        status: "rejected",
        submitter: member("secretary"),
        decider: member("president"),
        decidedAt: at(-2),
        // Required exactly when status = rejected, and forbidden otherwise.
        rejectionReason: "Over the gala allocation. Resubmit under $1,200.",
        createdAt: at(-4),
      },
    ])
    .onConflictDoNothing();

  // entity_type and entity_id travel together or not at all
  // (notification_entity_all_or_nothing_check).
  await db
    .insert(notifications)
    .values([
      {
        id: demoId("notif:assigned"),
        userId: member("director"),
        kind: "task_assigned",
        body: "President assigned you “Film the opening keynote”.",
        entityType: "task",
        entityId: task("film-keynote"),
        createdAt: at(-2),
      },
      {
        id: demoId("notif:due"),
        userId: member("secretary"),
        kind: "task_due",
        body: "“Book the venue AV” is due tomorrow.",
        entityType: "task",
        entityId: task("venue-av"),
        createdAt: at(-1),
      },
      {
        id: demoId("notif:mention"),
        userId: member("director"),
        kind: "mention",
        body: "Officer mentioned you in #media.",
        entityType: "message",
        entityId: message("shot-list"),
        createdAt: at(-1),
      },
      {
        id: demoId("notif:expense"),
        userId: member("director"),
        kind: "expense_decided",
        body: "Your camera rental claim was approved.",
        entityType: "expense",
        entityId: demoId("expense:camera"),
        readAt: at(-1),
        createdAt: at(-1),
      },
      {
        id: demoId("notif:event"),
        userId: member("officer"),
        kind: "event_created",
        body: "New event: Semester 2 Hackathon.",
        entityType: "event",
        entityId: event("hackathon"),
        readAt: at(-3),
        createdAt: at(-5),
      },
      // Both entity columns NULL — the other legal half of the constraint.
      {
        id: demoId("notif:invite"),
        userId: member("president"),
        kind: "invite_accepted",
        body: "A new officer accepted their invite.",
        createdAt: at(-6),
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(auditLog)
    .values([
      {
        id: demoId("audit:event-created"),
        actorId: member("president"),
        action: "event.created",
        entityType: "event",
        entityId: event("hackathon"),
        changes: { title: { from: null, to: "Semester 2 Hackathon" } },
        createdAt: at(-10),
      },
      {
        id: demoId("audit:expense-approved"),
        actorId: member("treasurer"),
        action: "expense.approved",
        entityType: "expense",
        entityId: demoId("expense:camera"),
        changes: { status: { from: "pending", to: "approved" } },
        createdAt: at(-1),
      },
      {
        id: demoId("audit:task-updated"),
        actorId: member("officer"),
        action: "task.updated",
        entityType: "task",
        entityId: task("highlight-reel"),
        changes: { status: { from: "todo", to: "in_progress" } },
        createdAt: at(-1),
      },
    ])
    .onConflictDoNothing();

  // One invite per reachable state. accepted_at and revoked_at are mutually
  // exclusive (invite_not_both_accepted_and_revoked_check), and email must
  // already be lowercase (invite_email_lowercase_check).
  await db
    .insert(invites)
    .values([
      {
        id: demoId("invite:live"),
        email: "newcomer@example.com",
        role: "officer",
        expiresAt: at(7),
        createdAt: at(-1),
      },
      {
        id: demoId("invite:accepted"),
        email: "alumni@example.com",
        role: "officer",
        expiresAt: at(-3),
        acceptedAt: at(-10),
        createdAt: at(-17),
      },
      {
        id: demoId("invite:revoked"),
        email: "mistake@example.com",
        role: "director",
        expiresAt: at(2),
        revokedAt: at(-5),
        createdAt: at(-8),
      },
    ])
    .onConflictDoNothing();
}
