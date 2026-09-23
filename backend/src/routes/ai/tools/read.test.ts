import { describe, expect, it } from "vitest";
import type { Queryable } from "../../events/service.js";
import { HandleMap } from "../handles.js";
import { countOpenTasksByAssignee, PLAN_CORPUS_EVENTS, READ_TOOLS, readBudget } from "./read.js";
import type { ToolContext } from "./registry.js";

/**
 * `listMembers`'s open-task count is new server-side code, not a reuse — no
 * backend route computes per-member open-task counts today, the dashboard's
 * Committee Load widget derives it client-side. This is the pure half of that
 * rule (the SQL wiring is exercised by integration tests elsewhere), so it is
 * unit-tested here with no database, the same split `computeProgress` in
 * `routes/events/service.ts` uses.
 */
describe("countOpenTasksByAssignee", () => {
  it("counts every not-done task for a member", () => {
    const counts = countOpenTasksByAssignee([
      { userId: "m1", status: "todo" },
      { userId: "m1", status: "in_progress" },
      { userId: "m1", status: "done" },
    ]);
    expect(counts.get("m1")).toBe(2);
  });

  it("counts a multi-assignee task once for each holder", () => {
    const counts = countOpenTasksByAssignee([
      { userId: "m1", status: "todo" },
      { userId: "m2", status: "todo" },
    ]);
    expect(counts.get("m1")).toBe(1);
    expect(counts.get("m2")).toBe(1);
  });

  it("never counts a done task", () => {
    const counts = countOpenTasksByAssignee([{ userId: "m1", status: "done" }]);
    expect(counts.has("m1")).toBe(false);
  });

  it("returns an empty map for a member with no assignments", () => {
    expect(countOpenTasksByAssignee([]).size).toBe(0);
  });
});

describe("PLAN_CORPUS_EVENTS", () => {
  it("is a small, positive, prompt-sized bound", () => {
    expect(PLAN_CORPUS_EVENTS).toBeGreaterThan(0);
    expect(PLAN_CORPUS_EVENTS).toBeLessThanOrEqual(10);
  });
});

// ── No read tool returns a UUID ──────────────────────────────────────────
//
// The other property this design rests on, alongside "the assistant cannot
// exceed the caller's tier": the model never sees an id, only a handle. This
// proves it against every read tool's OWN output-shaping code, not against
// the database — it should fail the moment someone's `.map()` adds `id:` (or
// spreads a raw row) to a return shape.

const FAKE_UUID = "0192f1a0-0000-7000-8000-000000000042";
const NOW = new Date("2026-01-01T00:00:00Z");
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-/iu;

/**
 * Every field any single read tool's query might project, in one row, so one
 * fake `db` stands in for all of them. Every identity-shaped column carries a
 * REAL uuid — the point is to prove each tool converts it to a handle rather
 * than passing it through; a tool that forgot would fail immediately.
 */
const ROW: Record<string, unknown> = {
  id: FAKE_UUID,
  eventId: FAKE_UUID,
  userId: FAKE_UUID,
  authUserId: FAKE_UUID,
  author: FAKE_UUID,
  name: "Fake Member",
  title: "Fake Row",
  eventTitle: "Fake Event",
  role: "officer",
  tier: 0,
  status: "todo",
  priority: "medium",
  category: "venue",
  venue: "Hall",
  body: "hello",
  visible: true,
  dueAt: NOW,
  startsAt: NOW,
  endsAt: NOW,
  createdAt: NOW,
  allocationCents: 1000,
  committedCents: 500,
  spentCents: 100,
  budgetCents: 2000,
  todo: 1,
  inProgress: 1,
  blocked: 0,
  done: 1,
  overdueCount: 0,
};

/**
 * A thenable that answers any further property access — `.from`, `.where`,
 * `.orderBy`, `.limit`, `.innerJoin`, anything a Drizzle query builder might
 * be chained with — by returning itself, so any combination resolves to the
 * same canned `rows`. Good enough to stand in for `ctx.db.select(...)...`
 * without hand-modelling Drizzle's real builder type.
 */
function chain(
  rows: readonly Record<string, unknown>[],
): PromiseLike<readonly Record<string, unknown>[]> {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: readonly Record<string, unknown>[]) => void) => resolve(rows);
        }
        return () => chain(rows);
      },
    },
  ) as unknown as PromiseLike<readonly Record<string, unknown>[]>;
}

/**
 * `select()` always resolves to `[ROW]` — every tool under test explicitly
 * names the fields it reads off a row, never spreads one whole, so a
 * kitchen-sink row is safe there. `execute()` is narrower: `getBudgetSummary`
 * (which `readBudget` calls) is the one function in this call graph that DOES
 * spread a whole row through (`byCategory`'s `{...row, ...}`), and its own
 * SQL scopes that particular query to `category`/`committedCents`/
 * `spentCents` — so a fake response wider than that would flag an id that
 * production code never actually selects. `executeRows`, consumed in call
 * order (defaulting to the same shared row every time), lets the dedicated
 * `readBudget` test below supply the three distinct shapes
 * `getBudgetSummary` really issues.
 */
function fakeDb(executeRows: readonly Record<string, unknown>[][] = [[ROW]]): Queryable {
  let call = 0;
  const db = {
    select: () => chain([ROW]),
    execute: () => {
      const rows = executeRows[Math.min(call, executeRows.length - 1)]!;
      call += 1;
      return Promise.resolve({ rows });
    },
  };
  return db as never;
}

function ctxFor(db: Queryable): ToolContext {
  const handles = new HandleMap();
  handles.issue("E", FAKE_UUID); // pre-issued so eventHandle-taking tools can resolve "E1"
  return { db, userId: FAKE_UUID, tier: 2, handles, staged: {} };
}

/** True if any string reachable from `value` looks like a UUID. */
function findUuid(value: unknown, path = "$"): string | undefined {
  if (typeof value === "string") {
    return UUID_PATTERN.test(value) ? `${path} = ${value}` : undefined;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findUuid(item, `${path}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      const found = findUuid(nested, `${path}.${key}`);
      if (found) return found;
    }
  }
  return undefined;
}

describe("no read tool returns a UUID", () => {
  it.each(READ_TOOLS.filter((tool) => tool.name !== "readBudget"))(
    "$name never returns a raw id",
    async (tool) => {
      const result = await tool.run(ctxFor(fakeDb()), { eventHandle: "E1" });
      expect(findUuid(result)).toBeUndefined();
    },
  );

  // readBudget's underlying getBudgetSummary issues three distinct queries
  // (totals, per-event allocations, per-category spend) — tailored so the
  // category query's real, narrow shape is what gets exercised, not the
  // kitchen-sink row every other tool above shares.
  it("readBudget converts every allocation's event id to a handle", async () => {
    const totals = {
      budgetCents: 2000,
      allocationCents: 1000,
      committedCents: 500,
      spentCents: 100,
    };
    const allocation = {
      eventId: FAKE_UUID,
      eventTitle: "Fake Event",
      allocationCents: 1000,
      committedCents: 500,
      spentCents: 100,
      startsAt: NOW,
      createdAt: NOW,
    };
    const category = { category: "venue", committedCents: 500, spentCents: 100 };
    const db = fakeDb([[totals], [allocation], [category]]);

    const result = await readBudget.run(ctxFor(db), {});
    expect(findUuid(result)).toBeUndefined();
  });
});
