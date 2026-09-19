import {
  taskPrioritySchema,
  taskStatusSchema,
  type EventSummary,
  type TaskPriority,
  type TaskStatus,
} from "@ctp/shared";
import { statusStyles } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The task board's filters, as the URL holds them. Every field is a server
 * query parameter (see `useTasks`), so the page keeps them in `useSearchParams`
 * and this component only reports what the reader asked for.
 */
export type TaskFilterState = {
  scope: "mine" | "all";
  status: TaskStatus | "";
  priority: TaskPriority | "";
  /** An event id, or `""` for every event. */
  event: string;
  overdue: boolean;
};

export const defaultTaskFilters: TaskFilterState = {
  scope: "all",
  status: "",
  priority: "",
  event: "",
  overdue: false,
};

/** Whether the reader has narrowed anything — what "Clear Filters" clears. */
export function isFiltered(filters: TaskFilterState): boolean {
  return (
    filters.scope !== defaultTaskFilters.scope ||
    filters.status !== "" ||
    filters.priority !== "" ||
    filters.event !== "" ||
    filters.overdue
  );
}

const selectClass =
  "h-9 cursor-pointer rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

const scopes: { value: TaskFilterState["scope"]; label: string }[] = [
  { value: "mine", label: "My Tasks" },
  { value: "all", label: "All Tasks" },
];

export function TaskFilters({
  filters,
  events,
  onScopeChange,
  onStatusChange,
  onPriorityChange,
  onEventChange,
  onOverdueChange,
  onClear,
}: {
  filters: TaskFilterState;
  /** The loaded event list, for the event picker. `undefined` while it loads. */
  events?: EventSummary[];
  onScopeChange: (next: TaskFilterState["scope"]) => void;
  onStatusChange: (next: TaskStatus | "") => void;
  onPriorityChange: (next: TaskPriority | "") => void;
  onEventChange: (next: string) => void;
  onOverdueChange: (next: boolean) => void;
  onClear: () => void;
}) {
  return (
    <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Task scope"
          className="flex gap-1 rounded-lg bg-secondary p-1"
        >
          {scopes.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filters.scope === option.value}
              onClick={() => onScopeChange(option.value)}
              className={cn(
                "flex-1 cursor-pointer rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-[background-color,color,box-shadow] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none lg:flex-none",
                filters.scope === option.value && "bg-card text-foreground shadow-sm",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <input
            id="task-overdue"
            type="checkbox"
            checked={filters.overdue}
            onChange={(event) => onOverdueChange(event.target.checked)}
            className="size-4 cursor-pointer rounded border accent-primary"
          />
          <Label htmlFor="task-overdue" className="cursor-pointer text-sm text-muted-foreground">
            Overdue only
          </Label>
        </div>

        {/* Overdue IS `status <> 'done'` on the server, so a second status
            filter would contradict rather than narrow it. The page drops the
            status parameter when this box is ticked, and the control is
            replaced by what the endpoint is actually reading. */}
        {filters.overdue ? (
          <p className="text-sm text-muted-foreground">Status: anything not done</p>
        ) : (
          <div className="flex items-center gap-2">
            <Label htmlFor="task-status" className="text-sm text-muted-foreground">
              Status
            </Label>
            <select
              id="task-status"
              value={filters.status}
              onChange={(event) => {
                const parsed = taskStatusSchema.safeParse(event.target.value);
                onStatusChange(parsed.success ? parsed.data : "");
              }}
              className={selectClass}
            >
              <option value="">Any status</option>
              {taskStatusSchema.options.map((option) => (
                <option key={option} value={option}>
                  {statusStyles[option].label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Label htmlFor="task-priority" className="text-sm text-muted-foreground">
            Priority
          </Label>
          <select
            id="task-priority"
            value={filters.priority}
            onChange={(event) => {
              const parsed = taskPrioritySchema.safeParse(event.target.value);
              onPriorityChange(parsed.success ? parsed.data : "");
            }}
            className={selectClass}
          >
            <option value="">Any priority</option>
            {taskPrioritySchema.options.map((option) => (
              <option key={option} value={option}>
                {option.charAt(0).toUpperCase() + option.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor="task-event" className="text-sm text-muted-foreground">
            Event
          </Label>
          <select
            id="task-event"
            value={filters.event}
            // No fabricated choices while the list is still loading — same rule
            // the create dialog's event picker follows.
            disabled={!events}
            onChange={(event) => onEventChange(event.target.value)}
            className={selectClass}
          >
            <option value="">Any event</option>
            {events?.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isFiltered(filters) && (
        <Button variant="outline" size="sm" onClick={onClear}>
          Clear Filters
        </Button>
      )}
    </div>
  );
}
