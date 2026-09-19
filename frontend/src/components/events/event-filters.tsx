import { eventStatusSchema } from "@ctp/shared";
import { statusStyles } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TimeFilter = "upcoming" | "past" | "all";

const times: { value: TimeFilter; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "all", label: "All" },
];

/** Whether the reader has narrowed anything — what "Clear Filters" clears. */
export function eventsFiltered(time: TimeFilter, status: string, mine: boolean): boolean {
  return time !== "upcoming" || status !== "" || mine;
}

/**
 * List filters. The time control is the same segmented control the Inbox uses —
 * a small set of mutually exclusive options, which is what `aria-pressed` buttons
 * are for. Every control only reports; the page turns them into query params.
 */
export function EventFilters({
  time,
  status,
  mine,
  onTimeChange,
  onStatusChange,
  onOwnerChange,
  onClear,
}: {
  time: TimeFilter;
  status: string;
  mine: boolean;
  onTimeChange: (next: TimeFilter) => void;
  onStatusChange: (next: string) => void;
  onOwnerChange: (next: boolean) => void;
  onClear: () => void;
}) {
  return (
    <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Event time filter"
          className="flex gap-1 rounded-lg bg-secondary p-1"
        >
          {times.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={time === option.value}
              onClick={() => onTimeChange(option.value)}
              className={cn(
                "flex-1 cursor-pointer rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-[background-color,color,box-shadow] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:flex-none",
                time === option.value && "bg-card text-foreground shadow-sm",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div
          className="flex gap-1 rounded-lg bg-secondary p-1"
          role="group"
          aria-label="Event owner"
        >
          <button
            type="button"
            aria-pressed={mine}
            onClick={() => onOwnerChange(!mine)}
            className={cn(
              "cursor-pointer rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-[background-color,color,box-shadow] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              mine && "bg-card text-foreground shadow-sm",
            )}
          >
            My Events
          </button>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground" htmlFor="event-status">
            Status
          </label>
          <select
            id="event-status"
            value={status}
            onChange={(event) => onStatusChange(event.target.value)}
            className="h-9 cursor-pointer rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {/* `cancelled` opts in: the API excludes it unless it is asked for by name. */}
            <option value="">Any status</option>
            {eventStatusSchema.options.map((option) => (
              <option key={option} value={option}>
                {statusStyles[option].label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {eventsFiltered(time, status, mine) && (
        <Button variant="outline" size="sm" onClick={onClear}>
          Clear Filters
        </Button>
      )}
    </div>
  );
}
