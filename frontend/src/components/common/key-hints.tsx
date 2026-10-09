import { hintText, useBindings, useShortcutsEnabled, type Hint } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

/**
 * The keys that work here, as a TUI footer prints them:
 *
 *   [w/s] move · [a/d] column · [enter] open · [n] new
 *
 * Written from the current bindings, so a rebind re-labels it.
 * Hidden from assistive tech (the `?` key list says the same, in full), and
 * gone while single-key shortcuts are off, so it never names a dead key.
 */
export function KeyHints({ hints, className }: { hints: Hint[]; className?: string }) {
  const enabled = useShortcutsEnabled();
  const keys = useBindings();
  if (!enabled) return null;
  return (
    <p aria-hidden="true" className={cn("font-mono text-xs text-muted-foreground", className)}>
      {hints.map((hint) => hintText(hint, keys)).join(" · ")}
    </p>
  );
}
