import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeNodeDb, nodeDb } from "./client.js";
import { newId } from "./id.js";

/**
 * One deliberately-failing insert per CHECK constraint.
 *
 * A constraint nobody has seen fire is a constraint nobody trusts — this file is
 * the proof that each one actually rejects what it claims to. It is also the
 * regression net for the schema: if a future migration drops or weakens a
 * constraint, exactly one test here goes red and names it.
 *
 * WHY RAW SQL AND NOT THE DRIZZLE QUERY BUILDER: the columns are typed with
 * `$type<TaskStatus>()` and friends, so `status: "archived"` would be a
 * COMPILE error and the test could never reach the database. Raw SQL is what
 * lets us prove the constraint holds at the only layer that matters at runtime.
 */

const db = nodeDb();

// Scaffold — valid parent rows the deliberately-invalid children hang off.
const AUTH_A = "test-constraint-a";
const AUTH_B = "test-constraint-b";
const AUTH_SPARE = "test-constraint-spare";
const userA = newId();
const userB = newId();
const teamId = newId();
const eventId = newId();
const channelId = newId();

/**
 * Runs an insert that is expected to violate a constraint and returns the name
 * of the constraint the database reported. Returning the name (rather than
 * asserting inside) makes a failure message say which constraint fired instead
 * of just "expected throw".
 */
async function violatedConstraint(statement: string): Promise<string> {
  try {
    await db.execute(sql.raw(statement));
  } catch (error) {
    const raw = (error as { cause?: unknown }).cause ?? error;
    const err = raw as { constraint?: string; code?: string; column?: string };
    if (err.constraint) return err.constraint;
    // 23502 = not_null_violation. It carries `column`, not `constraint`.
    if (err.code === "23502" && err.column) return `not_null:${err.column}`;
    return `NO_CONSTRAINT_NAME: ${String(error)}`;
  }
  return "NO_ERROR_THROWN";
}

beforeAll(async () => {
  const now = new Date().toISOString();
  for (const [id, name] of [
    [AUTH_A, "Constraint A"],
    [AUTH_B, "Constraint B"],
    [AUTH_SPARE, "Constraint Spare"],
  ]) {
    await db.execute(sql`
      INSERT INTO auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${id}, ${name}, ${`${id}@example.com`}, true, ${now}, ${now})
      ON CONFLICT (id) DO NOTHING
    `);
  }
  await db.execute(sql`
    INSERT INTO "app_user" ("id", "auth_user_id", "role") VALUES
      (${userA}::uuid, ${AUTH_A}, 'officer'),
      (${userB}::uuid, ${AUTH_B}, 'officer')
    ON CONFLICT ("auth_user_id") DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO "team" ("id", "name") VALUES (${teamId}::uuid, ${`constraint-team-${teamId}`})
  `);
  await db.execute(sql`
    INSERT INTO "event" ("id", "title", "starts_at")
    VALUES (${eventId}::uuid, 'Constraint Event', now())
  `);
  // A membership-gated channel, so the `team`-kind tests below are free to use
  // teamId without tripping the channel_one_per_team unique index.
  await db.execute(sql`
    INSERT INTO "channel" ("id", "kind", "name") VALUES (${channelId}::uuid, 'group', 'Constraints')
  `);
});

afterAll(async () => {
  // Dependency order matters: expense RESTRICTs event and team, and app_user
  // RESTRICTs auth."user" (rule 15).
  for (const statement of [
    sql`DELETE FROM "message" WHERE "channel_id" = ${channelId}::uuid`,
    sql`DELETE FROM "ai_run" WHERE "channel_id" = ${channelId}::uuid`,
    sql`DELETE FROM "channel" WHERE "id" = ${channelId}::uuid`,
    sql`DELETE FROM "event" WHERE "id" = ${eventId}::uuid`,
    sql`DELETE FROM "team" WHERE "id" = ${teamId}::uuid`,
    sql`DELETE FROM "app_user" WHERE "auth_user_id" LIKE 'test-constraint-%'`,
    sql`DELETE FROM auth."user" WHERE id LIKE 'test-constraint-%'`,
  ]) {
    await db.execute(statement);
  }
  await closeNodeDb();
});

describe("app_user constraints", () => {
  /**
   * An unknown role IS rejected — but by the NOT NULL on the generated `tier`
   * column, not by app_user_role_check. Postgres computes a STORED generated
   * column BEFORE evaluating CHECK constraints, so the CASE falls through to
   * ELSE NULL and the not-null violation fires first.
   *
   * That is the designed behaviour ("you cannot half-add a position"), and it
   * means app_user_role_check is belt-and-braces rather than the active gate:
   * both the CHECK list and the CASE arms are generated from roleSchema, so a
   * value can never satisfy one and not the other. Asserting the real error
   * here rather than the one we assumed keeps this test honest.
   */
  it("rejects an unknown role via the generated tier column", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "app_user" ("id", "auth_user_id", "role")
         VALUES ('${newId()}', '${AUTH_SPARE}', 'admin')`,
      ),
    ).toBe("not_null:tier");
  });
});

describe("team constraints", () => {
  it("rejects a blank name", async () => {
    expect(
      await violatedConstraint(`INSERT INTO "team" ("id", "name") VALUES ('${newId()}', '   ')`),
    ).toBe("team_name_not_blank_check");
  });
});

describe("invite constraints", () => {
  it("rejects a non-lowercase email", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "invite" ("id", "email", "role", "expires_at")
         VALUES ('${newId()}', 'Mixed@Example.com', 'officer', now() + interval '7 days')`,
      ),
    ).toBe("invite_email_lowercase_check");
  });

  it("rejects an unknown role", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "invite" ("id", "email", "role", "expires_at")
         VALUES ('${newId()}', 'x@example.com', 'admin', now() + interval '7 days')`,
      ),
    ).toBe("invite_role_check");
  });

  it("rejects being both accepted and revoked", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "invite" ("id", "email", "role", "expires_at", "accepted_at", "revoked_at")
         VALUES ('${newId()}', 'x@example.com', 'officer', now(), now(), now())`,
      ),
    ).toBe("invite_not_both_accepted_and_revoked_check");
  });
});

describe("event constraints", () => {
  it("rejects a blank title", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "event" ("id", "title", "starts_at") VALUES ('${newId()}', '  ', now())`,
      ),
    ).toBe("event_title_not_blank_check");
  });

  it("rejects an unknown status", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "event" ("id", "title", "starts_at", "status")
         VALUES ('${newId()}', 'E', now(), 'archived')`,
      ),
    ).toBe("event_status_check");
  });

  it("rejects a negative allocation", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "event" ("id", "title", "starts_at", "allocation_cents")
         VALUES ('${newId()}', 'E', now(), -1)`,
      ),
    ).toBe("event_allocation_non_negative_check");
  });

  it("rejects a min_tier outside 0..2", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "event" ("id", "title", "starts_at", "min_tier")
         VALUES ('${newId()}', 'E', now(), 3)`,
      ),
    ).toBe("event_min_tier_range_check");
  });

  it("rejects an end before the start", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "event" ("id", "title", "starts_at", "ends_at")
         VALUES ('${newId()}', 'E', now(), now() - interval '1 hour')`,
      ),
    ).toBe("event_ends_after_start_check");
  });
});

describe("task constraints", () => {
  it("rejects a blank title", async () => {
    expect(
      await violatedConstraint(`INSERT INTO "task" ("id", "title") VALUES ('${newId()}', ' ')`),
    ).toBe("task_title_not_blank_check");
  });

  it("rejects an unknown status", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "task" ("id", "title", "status") VALUES ('${newId()}', 'T', 'archived')`,
      ),
    ).toBe("task_status_check");
  });

  it("rejects an unknown priority", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "task" ("id", "title", "priority") VALUES ('${newId()}', 'T', 'critical')`,
      ),
    ).toBe("task_priority_check");
  });

  it("rejects a min_tier outside 0..2", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "task" ("id", "title", "min_tier") VALUES ('${newId()}', 'T', 5)`,
      ),
    ).toBe("task_min_tier_range_check");
  });

  it("rejects completed_at disagreeing with status", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "task" ("id", "title", "status", "completed_at")
         VALUES ('${newId()}', 'T', 'todo', now())`,
      ),
    ).toBe("task_completed_at_matches_status_check");
  });
});

describe("channel constraints", () => {
  it("rejects an unknown kind", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "channel" ("id", "kind", "name") VALUES ('${newId()}', 'thread', 'X')`,
      ),
    ).toBe("channel_kind_check");
  });

  it("rejects a min_tier outside 0..2", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "channel" ("id", "kind", "name", "team_id", "min_tier")
         VALUES ('${newId()}', 'team', 'X', '${teamId}', 4)`,
      ),
    ).toBe("channel_min_tier_range_check");
  });

  it("rejects a parent that does not match the kind", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "channel" ("id", "kind", "name") VALUES ('${newId()}', 'team', 'X')`,
      ),
    ).toBe("channel_parent_matches_kind_check");
  });

  it("rejects min_tier on a membership-gated channel", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "channel" ("id", "kind", "name", "min_tier")
         VALUES ('${newId()}', 'group', 'X', 1)`,
      ),
    ).toBe("channel_min_tier_only_when_tier_gated_check");
  });

  it("rejects a nameless non-dm channel", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "channel" ("id", "kind") VALUES ('${newId()}', 'group')`,
      ),
    ).toBe("channel_named_unless_dm_check");
  });
});

describe("message constraints", () => {
  it("rejects a message with neither body nor file", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "message" ("id", "channel_id", "body") VALUES ('${newId()}', '${channelId}', '')`,
      ),
    ).toBe("message_has_content_check");
  });

  it("rejects a partially-specified attachment", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "message" ("id", "channel_id", "body", "file_key")
         VALUES ('${newId()}', '${channelId}', 'x', 'k/1')`,
      ),
    ).toBe("message_file_all_or_nothing_check");
  });

  it("rejects a zero-byte attachment", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "message"
           ("id", "channel_id", "body", "file_key", "file_name", "file_size_bytes", "file_mime")
         VALUES ('${newId()}', '${channelId}', 'x', 'k/1', 'a.png', 0, 'image/png')`,
      ),
    ).toBe("message_file_size_positive_check");
  });

  it("rejects a message that is its own parent", async () => {
    const id = newId();
    expect(
      await violatedConstraint(
        `INSERT INTO "message" ("id", "channel_id", "body", "parent_id")
         VALUES ('${id}', '${channelId}', 'x', '${id}')`,
      ),
    ).toBe("message_not_own_parent_check");
  });
});

describe("expense constraints", () => {
  const base = `"id", "description", "category", "amount_cents"`;

  it("rejects a non-positive amount", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "expense" (${base}) VALUES ('${newId()}', 'Pizza', 'catering', 0)`,
      ),
    ).toBe("expense_amount_positive_check");
  });

  it("rejects a blank description", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "expense" (${base}) VALUES ('${newId()}', '  ', 'catering', 100)`,
      ),
    ).toBe("expense_description_not_blank_check");
  });

  it("rejects an unknown category", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "expense" (${base}) VALUES ('${newId()}', 'Pizza', 'Food', 100)`,
      ),
    ).toBe("expense_category_check");
  });

  it("rejects an unknown status", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "expense" (${base}, "status", "decided_at")
         VALUES ('${newId()}', 'Pizza', 'catering', 100, 'refunded', now())`,
      ),
    ).toBe("expense_status_check");
  });

  it("rejects rejected-without-a-reason", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "expense" (${base}, "status", "decided_at")
         VALUES ('${newId()}', 'Pizza', 'catering', 100, 'rejected', now())`,
      ),
    ).toBe("expense_rejection_reason_matches_status_check");
  });

  it("rejects a decider who is also the submitter", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "expense" (${base}, "status", "decided_at", "submitter", "decider")
         VALUES ('${newId()}', 'Pizza', 'catering', 100, 'approved', now(),
                 '${userA}', '${userA}')`,
      ),
    ).toBe("expense_decider_is_not_submitter_check");
  });

  it("rejects a pending expense that already has decided_at", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "expense" (${base}, "status", "decided_at")
         VALUES ('${newId()}', 'Pizza', 'catering', 100, 'pending', now())`,
      ),
    ).toBe("expense_decided_at_matches_status_check");
  });

  it("rejects paid_at on a non-paid expense", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "expense" (${base}, "status", "decided_at", "paid_at")
         VALUES ('${newId()}', 'Pizza', 'catering', 100, 'approved', now(), now())`,
      ),
    ).toBe("expense_paid_at_matches_status_check");
  });
});

describe("settings constraints", () => {
  it("rejects a second settings row", async () => {
    expect(await violatedConstraint(`INSERT INTO "settings" ("id") VALUES (2)`)).toBe(
      "settings_singleton_check",
    );
  });

  it("rejects a negative budget", async () => {
    expect(
      await violatedConstraint(`UPDATE "settings" SET "budget_cents" = -1 WHERE "id" = 1`),
    ).toBe("settings_budget_non_negative_check");
  });
});

describe("notification constraints", () => {
  it("rejects an unknown kind", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "notification" ("id", "user_id", "kind", "body")
         VALUES ('${newId()}', '${userA}', 'task_deleted', 'x')`,
      ),
    ).toBe("notification_kind_check");
  });

  it("rejects a half-specified entity reference", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "notification" ("id", "user_id", "kind", "body", "entity_type")
         VALUES ('${newId()}', '${userA}', 'mention', 'x', 'task')`,
      ),
    ).toBe("notification_entity_all_or_nothing_check");
  });
});

describe("ai_run constraints", () => {
  it("rejects a negative cost", async () => {
    expect(
      await violatedConstraint(
        `INSERT INTO "ai_run" ("id", "channel_id", "prompt", "cost_micro_usd")
         VALUES ('${newId()}', '${channelId}', 'hello', -1)`,
      ),
    ).toBe("ai_run_cost_non_negative_check");
  });
});
