import type { BudgetSummary, Risk } from "@ctp/shared";
import { sql } from "drizzle-orm";
import type { Queryable, Tx } from "../events/service.js";
import { BudgetExceededError, computeProgress } from "../events/service.js";

interface RiskEvent {
  startsAt: Date;
  createdAt: Date;
  allocationCents: number;
  committedCents: number;
}

export function budgetRisk(
  budgetCents: number,
  committedCents: number,
  eventRows: readonly RiskEvent[],
  now = new Date(),
): Risk {
  if (committedCents > budgetCents) return "critical";
  const risks = eventRows.map(
    (event) =>
      computeProgress({
        ...event,
        taskCounts: { todo: 0, inProgress: 0, blocked: 0, done: 0 },
        overdueCount: 0,
        now,
      }).risk,
  );
  if (risks.includes("critical")) return "critical";
  return risks.includes("at_risk") ? "at_risk" : "on_track";
}

export async function setBudget(tx: Tx, budgetCents: number): Promise<void> {
  await tx.execute(sql`INSERT INTO "settings" (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  await tx.execute(sql`SELECT id FROM "settings" WHERE id = 1 FOR UPDATE`);
  const result = await tx.execute<{ total: number }>(sql`
    SELECT COALESCE(SUM(allocation_cents), 0) AS total
    FROM "event"
    WHERE status <> 'cancelled'
  `);
  if (Number(result.rows[0]?.total ?? 0) > budgetCents) {
    throw new BudgetExceededError("The club budget cannot be lower than current allocations.");
  }
  await tx.execute(sql`
    UPDATE "settings" SET budget_cents = ${budgetCents}, updated_at = now() WHERE id = 1
  `);
}

interface SummaryRow {
  [key: string]: unknown;
  budgetCents: string;
  allocationCents: string;
  committedCents: string;
  spentCents: string;
}

interface AllocationRow {
  [key: string]: unknown;
  eventId: string;
  eventTitle: string;
  allocationCents: string;
  committedCents: string;
  spentCents: string;
  startsAt: string;
  createdAt: string;
}

interface CategoryRow {
  [key: string]: unknown;
  category: BudgetSummary["byCategory"][number]["category"];
  committedCents: string;
  spentCents: string;
}

export async function getBudgetSummary(db: Queryable): Promise<BudgetSummary> {
  const totalsResult = await db.execute<SummaryRow>(sql`
    SELECT
      COALESCE((SELECT budget_cents FROM "settings" WHERE id = 1), 0) AS "budgetCents",
      COALESCE((SELECT SUM(allocation_cents) FROM "event" WHERE status <> 'cancelled'), 0) AS "allocationCents",
      COALESCE((SELECT SUM(amount_cents) FROM "expense" WHERE status IN ('approved', 'paid')), 0) AS "committedCents",
      COALESCE((SELECT SUM(amount_cents) FROM "expense" WHERE status = 'paid'), 0) AS "spentCents"
  `);
  const allocationResult = await db.execute<AllocationRow>(sql`
    SELECT
      e.id AS "eventId", e.title AS "eventTitle", e.allocation_cents AS "allocationCents",
      e.starts_at AS "startsAt", e.created_at AS "createdAt",
      COALESCE(SUM(x.amount_cents) FILTER (WHERE x.status IN ('approved', 'paid')), 0) AS "committedCents",
      COALESCE(SUM(x.amount_cents) FILTER (WHERE x.status = 'paid'), 0) AS "spentCents"
    FROM "event" e
    LEFT JOIN "expense" x ON x.event_id = e.id
    WHERE e.status <> 'cancelled'
    GROUP BY e.id, e.title, e.allocation_cents, e.starts_at
    ORDER BY e.starts_at, e.id
  `);
  const categoryResult = await db.execute<CategoryRow>(sql`
    SELECT category,
      SUM(amount_cents) AS "committedCents",
      COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0) AS "spentCents"
    FROM "expense"
    WHERE status IN ('approved', 'paid')
    GROUP BY category
    ORDER BY category
  `);

  const totals = totalsResult.rows[0];
  const budgetCents = Number(totals?.budgetCents ?? 0);
  const allocationCents = Number(totals?.allocationCents ?? 0);
  const committedCents = Number(totals?.committedCents ?? 0);
  const spentCents = Number(totals?.spentCents ?? 0);

  return {
    budgetCents,
    allocationCents,
    committedCents,
    spentCents,
    availableCents: budgetCents - allocationCents,
    risk: budgetRisk(
      budgetCents,
      committedCents,
      allocationResult.rows.map((row) => ({
        startsAt: new Date(row.startsAt),
        createdAt: new Date(row.createdAt),
        allocationCents: Number(row.allocationCents),
        committedCents: Number(row.committedCents),
      })),
    ),
    allocations: allocationResult.rows.map((row) => ({
      eventId: row.eventId,
      eventTitle: row.eventTitle,
      allocationCents: Number(row.allocationCents),
      committedCents: Number(row.committedCents),
      spentCents: Number(row.spentCents),
    })),
    byCategory: categoryResult.rows.map((row) => ({
      ...row,
      committedCents: Number(row.committedCents),
      spentCents: Number(row.spentCents),
    })),
  };
}
