import { createHash } from "node:crypto";
import {
  roleSchema,
  type ExpenseCategory,
  type ExpenseStatus,
  type NotificationKind,
  type Role,
} from "@ctp/shared";
import { fakerEN_AU as faker } from "@faker-js/faker";
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
  taskAssignees,
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
 * Notifications are the exception: they are per-recipient, so the feed is also
 * written for whoever FOUNDER_EMAIL and DEMO_DIRECTOR_EMAILS name and who has
 * signed in already. Those variables come from seedProduction, so dev and prod
 * address the same inboxes.
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

// Exec is management (tier 2) plus directors, led by the vice president. It is
// a team, not a rank — see docs/roles-and-permissions.md "Groups".
const TEAMS = [
  { slug: "exec", name: "Exec", lead: "vice_president" },
  { slug: "media", name: "Media", lead: "director" },
  { slug: "marketing", name: "Marketing", lead: "vice_president" },
  { slug: "sponsorship", name: "Sponsorship", lead: "treasurer" },
  { slug: "events", name: "Events", lead: "secretary" },
] as const satisfies readonly { slug: string; name: string; lead: Role }[];

const CLUB_EVENTS = [
  {
    slug: "trivia-night",
    title: "Interfaculty Trivia Night",
    description: "A social trivia fundraiser open to members and friends.",
    team: "events",
    owner: "secretary",
    tasks: ["Confirm the quizmaster", "Publish team registrations", "Order prizes"],
  },
  {
    slug: "club-expo",
    title: "Semester Club Expo Stall",
    description: "Recruit new members with demos, flyers and committee Q&A.",
    team: "marketing",
    owner: "vice_president",
    tasks: ["Print sign-up QR cards", "Schedule stall volunteers", "Prepare the club display"],
  },
  {
    slug: "member-showcase",
    title: "Member Showcase Evening",
    description: "An evening for members to present creative work and performances.",
    team: "media",
    owner: "director",
    tasks: ["Collect performer bios", "Run the technical rehearsal", "Publish the run sheet"],
  },
] as const satisfies readonly {
  slug: string;
  title: string;
  description: string;
  team: (typeof TEAMS)[number]["slug"];
  owner: Role;
  tasks: readonly string[];
}[];

export async function seedDemo(production = false): Promise<void> {
  const db = nodeDb();
  faker.seed(20_260_918);

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
  /**
   * A fixture member, by the role they hold. No fixture names `president`: the
   * office belongs to the real account `FOUNDER_EMAIL` creates an invite for, so
   * the demo's presidential rows — Exec's lead, the AI run, the executive DM, the
   * tasks it filed — are the vice president's (see `seed.ts`).
   */
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

  // Local dev only: the base seed created `seed-${role}` users, so give them
  // faker display names. In production those rows don't exist, so this no-ops.
  for (const role of roleSchema.options) {
    await db.execute(sql`
      UPDATE auth."user"
      SET name = ${faker.person.fullName()}, "updatedAt" = ${new Date()}
      WHERE id = ${`seed-${role}`}
    `);
  }

  // Faker-randomised extras enrich local dev only; the production demo seed
  // stays a fixed, deterministic fixture (see seed-demo.integration.test.ts).
  const generatedEvents = production
    ? []
    : CLUB_EVENTS.map((fixture) => {
        const startsInDays = faker.number.int({ min: 14, max: 90 });
        const startsAt = at(startsInDays, faker.number.int({ min: 9, max: 18 }));
        return {
          ...fixture,
          startsInDays,
          startsAt,
          endsAt: new Date(startsAt.getTime() + faker.number.int({ min: 2, max: 5 }) * HOUR),
          venue: `${faker.helpers.arrayElement(["Student Pavilion", "Arts West", "Union House", "South Lawn Hub"])}, Room ${faker.number.int({ min: 101, max: 499 })}`,
          allocationCents: faker.number.int({ min: 50, max: 160 }) * 1_000,
          attendanceEstimate: faker.number.int({ min: 40, max: 220 }),
        };
      });

  // The pool that event.allocation_cents divides up (rule 1) — set before any
  // event is inserted. Local dev needs headroom for the generated events above;
  // production keeps the curated 1M. Upgrade an untouched base seed once, then
  // preserve every later budget edit.
  await db.execute(sql`
    UPDATE "settings"
    SET "budget_cents" = ${production ? 1_000_000 : 2_000_000}, "updated_at" = ${new Date(now)}
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
        owner: member("vice_president"),
      },
    ])
    .onConflictDoNothing();

  if (generatedEvents.length) {
    await db
      .insert(events)
      .values(
        generatedEvents.map((fixture) => ({
          id: event(fixture.slug),
          title: fixture.title,
          description: fixture.description,
          venue: fixture.venue,
          startsAt: fixture.startsAt,
          endsAt: fixture.endsAt,
          allocationCents: fixture.allocationCents,
          attendanceEstimate: fixture.attendanceEstimate,
          owner: member(fixture.owner),
        })),
      )
      .onConflictDoNothing();
  }

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

  if (generatedEvents.length) {
    await db
      .insert(workstreams)
      .values(
        generatedEvents.map((fixture) => ({
          id: demoId(`ws:${fixture.slug}-${fixture.team}`),
          eventId: event(fixture.slug),
          teamId: team(fixture.team),
          brief: `${fixture.team === "events" ? "Deliver" : "Support"} ${fixture.title.toLowerCase()} from planning through pack-down.`,
          lead: member(fixture.owner),
          dueAt: at(fixture.startsInDays - 1),
        })),
      )
      .onConflictDoNothing();
  }

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
      // The slug keeps its original spelling because the id is derived from it, so
      // renaming it would strand the rows an earlier seed already wrote. Its two
      // members are the vice president and a director.
      { id: channel("dm-pres-dir"), kind: "dm" },
    ])
    .onConflictDoNothing();

  await db
    .insert(chanMembers)
    .values([
      { channelId: channel("committee"), userId: member("vice_president"), lastReadAt: at(-2) },
      { channelId: channel("committee"), userId: member("treasurer"), lastReadAt: at(-3) },
      { channelId: channel("committee"), userId: member("secretary"), lastReadAt: at(-1) },
      { channelId: channel("dm-pres-dir"), userId: member("vice_president"), lastReadAt: at(-1) },
      { channelId: channel("dm-pres-dir"), userId: member("director"), lastReadAt: at(-4) },
      { channelId: channel("assistant"), userId: member("vice_president"), lastReadAt: at(-1) },
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
        userId: member("vice_president"),
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
        description:
          "Two cameras on the main stage. Deliver the raw card by Sunday so Media can cut the reel.",
        status: "todo",
        priority: "high",
        creator: member("vice_president"),
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
        creator: member("vice_president"),
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
        description: "Waiting on the venue's preferred supplier to confirm the quote.",
        status: "blocked",
        priority: "urgent",
        creator: member("vice_president"),
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
        creator: member("vice_president"),
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
        creator: member("vice_president"),
        boardOrder: 0,
      },
      // Deliberately overdue, so task_overdue_idx has something to serve.
      {
        id: task("insurance"),
        title: "Renew the club insurance",
        description: "Quote expired last month — the treasurer has the renewal link.",
        status: "todo",
        priority: "urgent",
        creator: member("vice_president"),
        dueAt: at(-5),
        boardOrder: 1,
      },
    ])
    .onConflictDoNothing();

  if (generatedEvents.length) {
    await db
      .insert(tasks)
      .values(
        generatedEvents.flatMap((fixture) =>
          fixture.tasks.map((title, boardOrder) => ({
            id: task(`${fixture.slug}-${boardOrder}`),
            eventId: event(fixture.slug),
            teamId: team(fixture.team),
            title,
            status: faker.helpers.arrayElement(["todo", "todo", "in_progress"] as const),
            priority: faker.helpers.arrayElement(["medium", "high"] as const),
            creator: member(fixture.owner),
            dueAt: at(fixture.startsInDays - faker.number.int({ min: 2, max: 10 })),
            boardOrder,
          })),
        ),
      )
      .onConflictDoNothing();
  }

  await db
    .insert(taskAssignees)
    .values(
      (
        [
          ["film-keynote", "director"],
          ["highlight-reel", "officer"],
          ["speaker-lineup", "vice_president"],
          ["venue-av", "secretary"],
          ["return-furniture", "officer"],
          ["sponsor-deck", "treasurer"],
          ["final-headcount", "secretary"],
          ["constitution", "secretary"],
          ["insurance", "treasurer"],
        ] as const
      ).map(([taskSlug, memberSlug]) => ({
        taskId: task(taskSlug),
        userId: member(memberSlug),
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(messages)
    .values([
      {
        id: message("hack-venue"),
        channelId: channel("hackathon"),
        author: member("vice_president"),
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
        author: member("vice_president"),
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
        decider: member("treasurer"),
        decidedAt: at(-2),
        // Required exactly when status = rejected, and forbidden otherwise.
        rejectionReason: "Over the gala allocation. Resubmit under $1,200.",
        createdAt: at(-4),
      },
    ])
    .onConflictDoNothing();

  // The curator's four rows are one per status. These take the ledger to 30,
  // one page of 25 plus a remainder, because the finance page pages at 25
  // (frontend/src/hooks/use-finance.ts) and a four-row ledger can never show
  // Load More, a per-event allocation worth reading, or a category breakdown
  // that is more than the four rows themselves.
  //
  // Literals rather than faker: the production demo is a fixed fixture
  // (seed-demo.integration.test.ts) and a random ledger would move the budget
  // summary every run.
  //
  // Committed spend (approved + paid) lands oweek at 98% of its allocation,
  // hackathon at 74% and gala at 36%, so the summary shows a nearly-spent row
  // next to healthy ones and the club risk reads at_risk rather than critical.
  //
  // [description, category, amountCents, status, event slug | null, team slug]
  const ledger: readonly (readonly [
    string,
    ExpenseCategory,
    number,
    ExpenseStatus,
    string | null,
    (typeof TEAMS)[number]["slug"],
  ])[] = [
    ["Welcome night pizza order", "catering", 24_000, "paid", "oweek", "events"],
    ["Name badges and lanyards", "printing", 9_500, "approved", "oweek", "events"],
    ["Door prize vouchers", "other", 6_000, "approved", "oweek", "marketing"],
    ["Overnight snack run", "catering", 18_000, "paid", "hackathon", "events"],
    ["Judging platform subscription", "equipment", 22_000, "approved", "hackathon", "marketing"],
    ["Power boards and extension leads", "equipment", 14_500, "approved", "hackathon", "media"],
    [
      "Breakfast rolls for the Sunday judges",
      "catering",
      26_000,
      "approved",
      "hackathon",
      "events",
    ],
    ["Weekend parking permits", "transport", 12_000, "approved", "hackathon", "exec"],
    ["Team t-shirts", "marketing", 34_000, "approved", "hackathon", "marketing"],
    ["Domain and hosting for submissions", "equipment", 9_000, "approved", "hackathon", "media"],
    ["Projector hire for the demo room", "equipment", 17_500, "paid", "hackathon", "media"],
    ["Venue deposit", "venue", 40_000, "approved", "gala", "events"],
    ["Table centrepieces", "other", 12_000, "approved", "gala", "marketing"],
    ["Award trophies and engraving", "printing", 13_000, "paid", "gala", "exec"],
    ["Public liability insurance top-up", "other", 8_000, "approved", null, "exec"],
    ["Committee polo shirts", "marketing", 6_500, "approved", null, "exec"],
    ["Sponsor banner reprint", "printing", 11_000, "pending", "gala", "sponsorship"],
    ["Photographer deposit", "other", 30_000, "pending", "gala", "media"],
    ["Guest speaker gift", "other", 7_500, "pending", "hackathon", "marketing"],
    ["Extra marquee lighting", "equipment", 15_000, "pending", "oweek", "events"],
    ["AV cable replacement", "equipment", 4_200, "pending", "hackathon", "media"],
    ["Snack platters for the exec meeting", "catering", 9_800, "pending", null, "exec"],
    ["Banner stands", "marketing", 13_000, "rejected", null, "marketing"],
    ["Coach hire deposit", "transport", 28_000, "pending", "gala", "events"],
    ["Reimbursement — printer toner", "printing", 3_500, "rejected", null, "exec"],
    ["Trophy cabinet", "other", 21_000, "pending", null, "exec"],
  ];

  // Ids are derived from the row's position, so append to this table rather than
  // reordering it. The four curated rows above keep their own semantic ids.
  await db
    .insert(expenses)
    .values(
      ledger.map(([description, category, amountCents, status, eventSlug, teamSlug], index) => ({
        id: demoId(`expense:ledger-${index}`),
        eventId: eventSlug === null ? null : event(eventSlug),
        teamId: team(teamSlug),
        amountCents,
        description,
        category,
        status,
        submitter: member(index % 3 === 0 ? "secretary" : "director"),
        // Separation of duty: the decider is never the submitter, and a pending
        // row has not been decided at all (expense_decided_at_matches_status).
        // Both decisions are the treasurer's — the office that holds
        // `expense:approve` in every seed, since no fixture names a president.
        decider: status === "pending" ? null : member("treasurer"),
        decidedAt: status === "pending" ? null : at(-((index % 3) + 1)),
        paidAt: status === "paid" ? at(-(index % 3)) : null,
        rejectionReason: status === "rejected" ? "Not in this event's approved budget." : null,
        receiptKey: status === "pending" ? null : `demo/receipts/ledger-${index}.pdf`,
        createdAt: at(-(index + 4)),
      })),
    )
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
        body: "Your vice president assigned you “Film the opening keynote”.",
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
        userId: member("vice_president"),
        kind: "invite_accepted",
        body: "A new officer accepted their invite.",
        createdAt: at(-6),
      },
    ])
    .onConflictDoNothing();

  // The demo inbox belongs to the people who can actually sign in. The display
  // personas have no credentials by design (plan-dev-harness.md), so every
  // notification above belongs to an account nobody can open a session as.
  // FOUNDER_EMAIL and DEMO_DIRECTOR_EMAILS are the same variables
  // seedProduction invites from, so dev and prod address the same addresses.
  //
  // A membership row only appears once someone signs in and claims their invite,
  // so this resolves whichever of the configured people exist NOW and gives each
  // of them the feed. Rerun the seed after a sign-in to fill in the rest — the
  // ids are derived from slug + recipient, so a rerun adds nothing twice.
  const audience = process.env.FOUNDER_EMAIL
    ? demoInvitees(process.env.FOUNDER_EMAIL, process.env.DEMO_DIRECTOR_EMAILS)
    : [];
  const recipients = audience.length
    ? (
        await db.execute<{ id: string; email: string }>(sql`
          SELECT member."id", account."email"
          FROM "app_user" member
          JOIN auth."user" account ON account."id" = member."auth_user_id"
          WHERE lower(account."email") IN (
            ${sql.join(
              audience.map(({ email }) => sql`${email}`),
              sql`, `,
            )}
          )
        `)
      ).rows
    : [];

  if (recipients.length > 0) {
    // Only `event` has a per-row route, so only those two render as links; the
    // rest stay plain text by design (see the notification feed). Four unread and
    // one read, so the sidebar badge carries a number and the page shows both
    // states.
    const inbox: readonly {
      slug: string;
      kind: NotificationKind;
      body: string;
      entityType: string | null;
      entityId: string | null;
      read: boolean;
    }[] = [
      {
        slug: "event-created",
        kind: "event_created",
        body: "New event: Semester 2 Hackathon.",
        entityType: "event",
        entityId: event("hackathon"),
        read: false,
      },
      {
        slug: "event-moved",
        kind: "event_date_changed",
        body: "End of Year Gala has a new date — check the calendar.",
        entityType: "event",
        entityId: event("gala"),
        read: false,
      },
      {
        slug: "task-assigned",
        kind: "task_assigned",
        body: "You are assigned “Film the opening keynote”.",
        entityType: "task",
        entityId: task("film-keynote"),
        read: false,
      },
      {
        slug: "expense-decided",
        kind: "expense_decided",
        body: "The camera and lens rental claim was approved.",
        entityType: "expense",
        entityId: demoId("expense:camera"),
        read: false,
      },
      {
        slug: "mention",
        kind: "mention",
        body: "You were mentioned in #media.",
        entityType: "message",
        entityId: message("shot-list"),
        read: false,
      },
      {
        slug: "invite-accepted",
        kind: "invite_accepted",
        body: "A new officer accepted their invite.",
        entityType: null,
        entityId: null,
        read: true,
      },
    ];

    await db
      .insert(notifications)
      .values(
        recipients.flatMap(({ id, email }) =>
          inbox.map(({ slug, kind, body, entityType, entityId, read }) => ({
            id: demoId(`notif:${slug}:${email}`),
            userId: id,
            kind,
            body,
            entityType,
            entityId,
            readAt: read ? at(-2) : null,
            createdAt: at(-3),
          })),
        ),
      )
      .onConflictDoNothing();
  }

  await db
    .insert(auditLog)
    .values([
      {
        id: demoId("audit:event-created"),
        actorId: member("vice_president"),
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
