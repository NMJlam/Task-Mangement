import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The classic terminal spinner. Pure ASCII on purpose: braille spinners
 * (`⠋⠙⠹`) and block glyphs come from a taller fallback font on Windows, which
 * is how phase 1's `░` ended up overlapping the row below.
 */
const FRAMES = ["|", "/", "-", "\\"] as const;
const FRAME_MS = 120;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * A loading line as a console prints one: `| Loading Members…`. The label is
 * the status a screen reader announces; the spinner is decoration, and stands
 * still for anyone who has asked for less motion.
 */
export function LoadingLine({ label, className }: { label: string; className?: string }) {
  const [frame, setFrame] = useState(prefersReducedMotion() ? 2 : 0);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const timer = window.setInterval(
      () => setFrame((current) => (current + 1) % FRAMES.length),
      FRAME_MS,
    );
    return () => window.clearInterval(timer);
  }, []);

  return (
    <p role="status" className={cn("text-sm text-muted-foreground", className)}>
      <span aria-hidden="true" className="inline-block w-[1ch] font-mono text-ring">
        {FRAMES[frame]}
      </span>{" "}
      <span>{label}</span>
    </p>
  );
}
