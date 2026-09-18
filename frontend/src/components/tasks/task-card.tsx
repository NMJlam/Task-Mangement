import type { Task } from "@ctp/shared";
import { PriorityDot } from "@/components/common/priority-dot";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const shortDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/**
 * One task on the board. The whole card is the trigger, so it is a real
 * `<button>` rather than a div with an onClick — that is where Enter/Space and
 * the focus ring come from.
 */
export function TaskCard({
  task,
  onOpen,
  onMove,
  eventTitle,
}: {
  task: Task;
  onOpen: (task: Task) => void;
  onMove?: (direction: -1 | 1) => void;
  eventTitle?: string;
}) {
  return (
    <Card className="gap-3 py-0 shadow-none transition-[border-color,box-shadow] hover:border-input hover:shadow-sm">
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => onOpen(task)}
          onKeyDown={(event) => {
            if (!event.altKey || !onMove) return;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              onMove(event.key === "ArrowLeft" ? -1 : 1);
            }
          }}
          aria-keyshortcuts={onMove ? "Alt+ArrowLeft Alt+ArrowRight" : undefined}
          className={cn(
            "w-full rounded-xl px-4 py-4 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            onMove ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
          )}
        >
          <span className="flex items-start gap-2">
            <span className="mt-1.5">
              <PriorityDot priority={task.priority} />
            </span>
            <span className="text-sm leading-5 font-medium">{task.title}</span>
          </span>
          <span className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{task.dueAt ? `Due ${shortDate.format(task.dueAt)}` : "No due date"}</span>
            {eventTitle && (
              <span className="max-w-36 truncate rounded-md bg-secondary px-1.5 py-0.5 text-secondary-foreground">
                {eventTitle}
              </span>
            )}
          </span>
        </button>
      </CardContent>
    </Card>
  );
}
