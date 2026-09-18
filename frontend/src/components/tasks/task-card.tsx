import type { Task } from "@ctp/shared";
import { PriorityDot } from "@/components/common/priority-dot";
import { Card, CardContent } from "@/components/ui/card";

const shortDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/**
 * One task on the board. The whole card is the trigger, so it is a real
 * `<button>` rather than a div with an onClick — that is where Enter/Space and
 * the focus ring come from.
 */
export function TaskCard({ task, onOpen }: { task: Task; onOpen: (task: Task) => void }) {
  return (
    <Card className="gap-3 py-0 shadow-none transition-[border-color,box-shadow] hover:border-input hover:shadow-sm">
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => onOpen(task)}
          className="w-full cursor-pointer rounded-xl px-4 py-4 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="flex items-start gap-2">
            <span className="mt-1.5">
              <PriorityDot priority={task.priority} />
            </span>
            <span className="text-sm leading-5 font-medium">{task.title}</span>
          </span>
          <span className="mt-3 block text-xs text-muted-foreground">
            {task.dueAt ? `Due ${shortDate.format(task.dueAt)}` : "No due date"}
          </span>
        </button>
      </CardContent>
    </Card>
  );
}
