import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * An empty state as a shell prints one: the command that came back with
 * nothing, then the existing message.
 *
 *   $ ls tasks/
 *   No open tasks are assigned to you.
 *
 * The prompt line is decoration and hidden; the message is what a reader and a
 * screen reader take in, worded exactly as it was before.
 */
export function ShellEmpty({
  command,
  message,
  compact = false,
  className,
}: {
  command: string;
  message: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("text-center", compact ? "py-6" : "py-10", className)}>
      <p aria-hidden="true" className="font-mono text-xs text-muted-foreground">
        <span className="text-ring">$</span> {command}
      </p>
      <div className="mt-2 text-sm text-muted-foreground">{message}</div>
    </div>
  );
}
