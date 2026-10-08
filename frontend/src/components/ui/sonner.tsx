"use client";

import type { ReactNode } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { cn } from "@/lib/utils";

/**
 * A toast's kind as a log tag, `[ok]`, `[err]`, rather than an icon — the same
 * vocabulary as `LogLine`. Pure ASCII, so no glyph waits on a fallback font.
 */
function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs", className)}>[{children}]</span>;
}

const Toaster = (props: ToasterProps) => (
  <Sonner
    theme="system"
    className="toaster group"
    icons={{
      success: <Tag className="text-ok">ok</Tag>,
      info: <Tag>..</Tag>,
      warning: <Tag className="text-warn">!!</Tag>,
      error: <Tag className="text-danger">err</Tag>,
      loading: <Tag>..</Tag>,
    }}
    style={
      {
        "--normal-bg": "var(--card)",
        "--normal-text": "var(--card-foreground)",
        "--normal-border": "var(--border)",
        // Sonner's own default is a pill-ish radius; the app has none.
        "--border-radius": "0px",
      } as React.CSSProperties
    }
    {...props}
  />
);

export { Toaster };
