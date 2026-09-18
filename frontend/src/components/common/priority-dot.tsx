import type { TaskPriority } from "@ctp/shared";
import { cn } from "@/lib/utils";

export function PriorityDot({ priority }: { priority: TaskPriority }) {
  return (
    <span
      className={cn(
        "inline-flex size-2 shrink-0 rounded-full",
        priority === "urgent" && "bg-red-600",
        priority === "high" && "bg-amber-500",
        priority === "medium" && "bg-indigo-500",
        priority === "low" && "bg-muted-foreground",
      )}
    >
      <span className="sr-only">{priority} priority</span>
    </span>
  );
}
