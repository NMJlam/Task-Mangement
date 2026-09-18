import type { EventProgress } from "@ctp/shared";
import { StatusBadge } from "@/components/status-badge";

/**
 * The verdict from `GET /api/events/:id/progress` — the one surface that has the
 * whole picture, since `risk` folds in `daysUntil` (club timezone) and budget burn
 * alongside the task counts `EventHealthStrip` already shows. Read-only, so a plain
 * `dl` is the right shape and no keyboard handling is needed.
 */
export function EventRiskPanel({ progress }: { progress: EventProgress }) {
  const { percentComplete, daysUntil, budgetBurn, risk, riskReasons } = progress;

  return (
    <div data-slot="event-risk-panel">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Risk</h3>
        <StatusBadge status={risk} />
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-4">
        <Metric label="Complete" value={`${percentComplete}%`} />
        <Metric label="Timing" value={countdown(daysUntil)} />
        <Metric
          label="Budget burn"
          value={budgetBurn === null ? "Not allocated" : `${Math.round(budgetBurn * 100)}%`}
        />
      </dl>
      {riskReasons.length > 0 && (
        <ul className="mt-4 grid gap-1.5 border-t pt-4 text-sm text-muted-foreground">
          {riskReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** `daysUntil` is negative once the event has passed (club timezone, not UTC). */
function countdown(daysUntil: number) {
  if (daysUntil === 0) return "Today";
  const days = Math.abs(daysUntil);
  const plural = days === 1 ? "day" : "days";
  return daysUntil > 0 ? `${days} ${plural}` : `${days} ${plural} ago`;
}
