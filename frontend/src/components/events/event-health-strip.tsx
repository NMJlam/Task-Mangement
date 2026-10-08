import type { EventBudget, TaskCounts } from "@ctp/shared";
import { TextMeter } from "@/components/common/text-meter";
import { cn } from "@/lib/utils";

/**
 * A slim per-event status readout: percent complete, an overdue flag, and
 * budget burn — everything `GET /api/events` already returns on each row, so
 * this never needs its own fetch (the full risk verdict from `/progress`
 * needs `daysUntil` and the club timezone, which the list read doesn't carry;
 * that belongs on a future event-detail page, not here).
 *
 * Not interactive — a status readout, not a control — so the completion bar is
 * a `TextMeter` (`role="progressbar"`, drawn as `[████░░]`), not a hand-rolled
 * interactive widget needing keyboard handling.
 */
export function EventHealthStrip({
  taskCounts,
  overdueCount,
  budget,
  subject,
}: {
  taskCounts: TaskCounts;
  overdueCount: number;
  budget: EventBudget;
  /**
   * The event this strip reports on, when the surrounding page holds several.
   * A list of cards each announcing "Tasks complete" is a list of progress bars
   * a screen reader cannot tell apart.
   */
  subject?: string;
}) {
  const total = taskCounts.todo + taskCounts.inProgress + taskCounts.blocked + taskCounts.done;
  const percentComplete = total === 0 ? 0 : Math.round((taskCounts.done / total) * 100);
  const burn = budget.allocationCents === 0 ? null : budget.committedCents / budget.allocationCents;

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm"
      data-slot="event-health-strip"
    >
      <TextMeter
        value={percentComplete}
        max={100}
        label={subject ? `${subject} tasks complete` : "Tasks complete"}
        valueText={`${percentComplete}% complete`}
      />
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
