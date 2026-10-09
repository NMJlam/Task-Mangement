import { useSyncExternalStore } from "react";

/**
 * The pages `go` then a letter jumps to. The sidebar's hints, the key list and
 * the handler all read this one table, so a hint cannot name a key that does
 * nothing. Each letter is a default; Settings can rebind it.
 */
export const GO_TO = [
  { id: "overview", key: "o", to: "/", label: "Overview" },
  { id: "events", key: "e", to: "/events", label: "Events" },
  { id: "tasks", key: "t", to: "/tasks", label: "Tasks" },
  { id: "calendar", key: "c", to: "/calendar", label: "Calendar" },
  { id: "finance", key: "f", to: "/finance", label: "Finance" },
  { id: "inbox", key: "i", to: "/notifications", label: "Inbox" },
  { id: "messages", key: "m", to: "/messages", label: "Messages" },
  { id: "ai", key: "a", to: "/ai", label: "AI Breakdown" },
  { id: "members", key: "p", to: "/members", label: "Members" },
  { id: "settings", key: "s", to: "/settings", label: "Settings" },
] as const;

export type PageId = (typeof GO_TO)[number]["id"];

/**
 * The single-key actions, with their default keys. The four list moves sit on
 * W A S D, the arrow cluster's shape on letters: real arrow keys already
 * scroll the page.
 */
export const ACTIONS = [
  { id: "new", key: "n", label: "New", description: "The page’s new action" },
  { id: "search", key: "/", label: "Search", description: "The page’s search" },
  { id: "help", key: "?", label: "Key list", description: "This list" },
  { id: "previous", key: "w", label: "Previous row", description: "Up a row" },
  { id: "next", key: "s", label: "Next row", description: "Down a row" },
  { id: "left", key: "a", label: "Previous column", description: "Left a column" },
  { id: "right", key: "d", label: "Next column", description: "Right a column" },
  { id: "go", key: "g", label: "Go to", description: "Then a page’s key" },
] as const;

export type ActionId = (typeof ACTIONS)[number]["id"];

export type Bindings = {
  actions: Record<ActionId, string>;
  pages: Record<PageId, string>;
};

export type BindingTarget = { kind: "action"; id: ActionId } | { kind: "page"; id: PageId };

export const DEFAULT_BINDINGS: Bindings = {
  actions: Object.fromEntries(ACTIONS.map((action) => [action.id, action.key])) as Record<
    ActionId,
    string
  >,
  pages: Object.fromEntries(GO_TO.map((page) => [page.id, page.key])) as Record<PageId, string>,
};

const ENABLED_KEY = "shortcuts";
const BINDINGS_KEY = "keybinds";
const listeners = new Set<() => void>();
let enabled: boolean | undefined;
let current: Bindings | undefined;

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Single-key shortcuts are on unless this device turned them off (WCAG 2.1.4:
 * a speech-input user's dictated words would otherwise fire them). Storage can
 * be off-limits and throw, as `lib/theme.ts` explains; the choice then lasts
 * the visit.
 */
export function shortcutsEnabled(): boolean {
  if (enabled === undefined) {
    try {
      enabled = localStorage.getItem(ENABLED_KEY) !== "off";
    } catch {
      enabled = true;
    }
  }
  return enabled;
}

export function setShortcutsEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(ENABLED_KEY, on ? "on" : "off");
  } catch {
    // Nothing to remember it in; the choice lasts this visit.
  }
  notify();
}

/** The preference, live: Settings turning it off hides every hint at once. */
export function useShortcutsEnabled(): boolean {
  return useSyncExternalStore(subscribe, shortcutsEnabled, () => true);
}

/**
 * A key as bindings store and compare it. Letters are lower case, so Caps Lock
 * or a held Shift still reaches the shortcut; symbols are left as typed, which
 * is what keeps `/` and `?` apart.
 */
export function matchKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/** Why `key` cannot be bound: one printable character, and not space. */
function keyProblem(key: string): string | undefined {
  return key.length === 1 && key.trim() !== ""
    ? undefined
    : "Choose a single letter, number or symbol.";
}

/** The other binding in the same set that already uses `key`, if any. */
function clashOf(bindings: Bindings, target: BindingTarget, key: string): string | undefined {
  if (target.kind === "action") {
    const other = ACTIONS.find(
      (action) => action.id !== target.id && bindings.actions[action.id] === key,
    );
    return other?.label;
  }
  const other = GO_TO.find((page) => page.id !== target.id && bindings.pages[page.id] === key);
  return other && `Go to ${other.label}`;
}

/**
 * Reads stored bindings. A value that is not a usable key falls back to its
 * default; a set where two keys clash cannot all work, so that set reverts
 * whole. Exported for its test.
 */
export function parseBindings(raw: string | null): Bindings {
  let stored: unknown;
  try {
    stored = raw ? JSON.parse(raw) : undefined;
  } catch {
    stored = undefined;
  }
  const record = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const storedActions = record(record(stored).actions);
  const storedPages = record(record(stored).pages);

  const pick = (value: unknown, fallback: string) =>
    typeof value === "string" && keyProblem(value) === undefined ? matchKey(value) : fallback;
  const actions = Object.fromEntries(
    ACTIONS.map((action) => [action.id, pick(storedActions[action.id], action.key)]),
  ) as Record<ActionId, string>;
  const pages = Object.fromEntries(
    GO_TO.map((page) => [page.id, pick(storedPages[page.id], page.key)]),
  ) as Record<PageId, string>;

  const unique = (values: string[]) => new Set(values).size === values.length;
  return {
    actions: unique(Object.values(actions)) ? actions : { ...DEFAULT_BINDINGS.actions },
    pages: unique(Object.values(pages)) ? pages : { ...DEFAULT_BINDINGS.pages },
  };
}

/** This device's bindings, read once and then kept in step with every change. */
export function bindings(): Bindings {
  if (current === undefined) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(BINDINGS_KEY);
    } catch {
      // Off-limits storage: the defaults, for this visit.
    }
    current = parseBindings(raw);
  }
  return current;
}

function saveBindings(next: Bindings) {
  current = next;
  try {
    localStorage.setItem(BINDINGS_KEY, JSON.stringify(next));
  } catch {
    // Nothing to remember it in; the bindings last this visit.
  }
  notify();
}

/**
 * Binds `key` to `target`, or says why not: it must be one printable
 * character, and not already another action's (or another page's) key.
 */
export function setBinding(target: BindingTarget, key: string): string | undefined {
  const problem = keyProblem(key);
  if (problem) return problem;
  const normal = matchKey(key);
  const now = bindings();
  const clash = clashOf(now, target, normal);
  if (clash) return `That key is already used for ${clash}.`;
  saveBindings(
    target.kind === "action"
      ? { ...now, actions: { ...now.actions, [target.id]: normal } }
      : { ...now, pages: { ...now.pages, [target.id]: normal } },
  );
  return undefined;
}

export function resetBindings(): void {
  saveBindings({
    actions: { ...DEFAULT_BINDINGS.actions },
    pages: { ...DEFAULT_BINDINGS.pages },
  });
}

/** The bindings, live: a rebind in Settings re-labels every hint at once. */
export function useBindings(): Bindings {
  return useSyncExternalStore(subscribe, bindings, () => DEFAULT_BINDINGS);
}

/** The phrases a page header lists under its subtitle, from the current keys. */
export type Hint = "move" | "open" | "new" | "search" | "leave" | "help";

export function hintText(hint: Hint, keys: Bindings): string {
  const { actions } = keys;
  switch (hint) {
    case "move":
      return `[${actions.previous}/${actions.left}/${actions.next}/${actions.right}] move`;
    case "open":
      return "[enter] open";
    case "new":
      return `[${actions.new}] new`;
    case "search":
      return `[${actions.search}] search`;
    case "leave":
      return "[esc] leave chat box";
    case "help":
      return `[${actions.help}] help`;
  }
}

/**
 * Makes a control the page's new action or its search. The handler finds it
 * by `data-shortcut`; `aria-keyshortcuts` announces its current key only while
 * shortcuts are on.
 */
export function useShortcut(action: "new" | "search") {
  const on = useShortcutsEnabled();
  const keys = useBindings();
  return {
    "data-shortcut": action,
    "aria-keyshortcuts": on ? keys.actions[action] : undefined,
  } as const;
}
