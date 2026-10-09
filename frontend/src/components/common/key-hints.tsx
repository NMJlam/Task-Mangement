import { useShortcutsEnabled } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

/**
 * The keys that work here, as a TUI footer prints them:
 *
 *   [j/k] move · [h/l] column · [enter] open · [n] new
 *
 * Hidden from assistive tech (the `?` key list says the same, in full), and
 * gone while single-key shortcuts are off, so it never names a dead key.
 */
export function KeyHints({ keys, className }: { keys: string[]; className?: string }) {
  const enabled = useShortcutsEnabled();
  if (!enabled) return null;
  return (
    <p aria-hidden="true" className={cn("font-mono text-xs text-muted-foreground", className)}>
      {keys.join(" · ")}
    </p>
  );
}
