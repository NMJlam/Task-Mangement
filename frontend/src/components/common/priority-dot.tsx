import type { TaskPriority } from "@ctp/shared";
import { cn } from "@/lib/utils";

/** A block marker, not a bubble: two cells of the character grid, all-sharp. */
export function PriorityDot({ priority }: { priority: TaskPriority }) {
  return (
    <span
      className={cn(
        "inline-flex size-2 shrink-0",
        priority === "urgent" && "bg-danger",
        priority === "high" && "bg-warn",
        priority === "medium" && "bg-ring",
        priority === "low" && "bg-muted-foreground",
      )}
    >
      <span className="sr-only">{priority} priority</span>
    </span>
  );
}
