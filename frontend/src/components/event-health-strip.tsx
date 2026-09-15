import type { EventBudget, TaskCounts } from "@ctp/shared";
import { cn } from "@/lib/utils";

/**
 * A slim per-event status readout: percent complete, an overdue flag, and
 * budget burn — everything `GET /api/events` already returns on each row, so
 * this never needs its own fetch (the full risk verdict from `/progress`
 * needs `daysUntil` and the club timezone, which the list read doesn't carry;
 * that belongs on a future event-detail page, not here).
 *
 * Not interactive — a status readout, not a control — so a plain `div` with
 * `role="progressbar"` is the correct accessible shape, not a hand-rolled
 * interactive widget needing keyboard handling.
 */
export function EventHealthStrip({
  taskCounts,
  overdueCount,
  budget,
}: {
  taskCounts: TaskCounts;
  overdueCount: number;
  budget: EventBudget;
}) {
  const total = taskCounts.todo + taskCounts.inProgress + taskCounts.blocked + taskCounts.done;
  const percentComplete = total === 0 ? 0 : Math.round((taskCounts.done / total) * 100);
  const burn = budget.allocationCents === 0 ? null : budget.committedCents / budget.allocationCents;

  return (
    <div className="flex items-center gap-3 text-sm" data-slot="event-health-strip">
      <div
        role="progressbar"
        aria-label="Tasks complete"
        aria-valuenow={percentComplete}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-24 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${percentComplete}%` }}
        />
      </div>
      <span className="text-muted-foreground">{percentComplete}% complete</span>
      {overdueCount > 0 && (
        <span className="font-medium text-destructive">
          {overdueCount} overdue task{overdueCount === 1 ? "" : "s"}
        </span>
      )}
      {burn !== null && (
        <span className={cn("text-muted-foreground", burn > 1 && "font-medium text-destructive")}>
          {Math.round(burn * 100)}% of budget committed
        </span>
      )}
    </div>
  );
}
