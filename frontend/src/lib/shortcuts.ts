import { useSyncExternalStore } from "react";

/**
 * `g` then a letter jumps to a page. The sidebar's hints, the key list and the
 * handler all read this one table, so a hint cannot name a key that does
 * nothing.
 */
export const GO_TO = [
  { key: "o", to: "/", label: "Overview" },
  { key: "e", to: "/events", label: "Events" },
  { key: "t", to: "/tasks", label: "Tasks" },
  { key: "c", to: "/calendar", label: "Calendar" },
  { key: "f", to: "/finance", label: "Finance" },
  { key: "i", to: "/notifications", label: "Inbox" },
  { key: "m", to: "/messages", label: "Messages" },
  { key: "a", to: "/ai", label: "AI Breakdown" },
  { key: "p", to: "/members", label: "Members" },
  { key: "s", to: "/settings", label: "Settings" },
] as const;

const KEY = "shortcuts";
const listeners = new Set<() => void>();
let enabled: boolean | undefined;

/**
 * Single-key shortcuts are on unless this device turned them off (WCAG 2.1.4:
 * a speech-input user's dictated words would otherwise fire them). Storage can
 * be off-limits and throw, as `lib/theme.ts` explains; the choice then lasts
 * the visit.
 */
export function shortcutsEnabled(): boolean {
  if (enabled === undefined) {
    try {
      enabled = localStorage.getItem(KEY) !== "off";
    } catch {
      enabled = true;
    }
  }
  return enabled;
}

export function setShortcutsEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Nothing to remember it in; the choice lasts this visit.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The preference, live: Settings turning it off hides every hint at once. */
export function useShortcutsEnabled(): boolean {
  return useSyncExternalStore(subscribe, shortcutsEnabled, () => true);
}

/**
 * Makes a control the page's `n` (its new action) or `/` (its search). The
 * handler finds it by `data-shortcut`; `aria-keyshortcuts` announces the key
 * only while it would work.
 */
export function useShortcut(key: "n" | "/") {
  const on = useShortcutsEnabled();
  return { "data-shortcut": key, "aria-keyshortcuts": on ? key : undefined } as const;
}
