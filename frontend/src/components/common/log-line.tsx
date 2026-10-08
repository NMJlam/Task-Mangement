import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A message tagged the way a log line is: `[err] Couldn't load members: …`.
 *
 * An error is an alert and a success a status, as they were before; the tag is
 * decoration and hidden, and the message sits in its own span so it reads, and
 * matches, exactly as it did.
 */
export function LogLine({
  tone,
  children,
  className,
}: {
  tone: "err" | "ok";
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      role={tone === "err" ? "alert" : "status"}
      className={cn(
        "text-sm",
        tone === "err" ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      <span aria-hidden="true" className={cn("font-mono", tone === "ok" && "text-ok")}>
        [{tone}]
      </span>{" "}
      <span>{children}</span>
    </p>
  );
}
