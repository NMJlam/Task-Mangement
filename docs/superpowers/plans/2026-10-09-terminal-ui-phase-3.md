# Terminal UI Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app behave like a terminal app. It gains a keyboard layer (`g`-jumps, `n`, `/`, `?`, and a Settings off switch), TUI selection (inverse rows, a cursor bar, and `j/k/h/l`), and lazygit-style panes on Tasks, Messages and the Inbox.

**Architecture:**

- **Preference.** `lib/shortcuts.ts` owns the shortcut preference, a small external store read through `useSyncExternalStore`. It also owns the go-to map that the sidebar, the help list and the handler all read.
- **Handler.** One document-level handler, `KeyboardShortcuts`, mounted in the `AppShell`, acts on markup rather than on registered callbacks:
  - a page opts a control in with `data-shortcut="n"` or `data-shortcut="/"`;
  - a list opts in with `data-key-list` on its container and `data-key-item` on each row;
  - `lib/key-navigation.ts` moves real focus between those rows.
- **Selection.** Selection is styling on the row that holds keyboard focus (`.tui-row` / `.tui-card` in `index.css`). There is no new ARIA state.

**Tech Stack:** React 19, React Router 6, Tailwind v4 tokens, shadcn Dialog and Checkbox (Radix), Vitest and Testing Library, Playwright with axe.

**Spec:** Ideas 4, 5 and 10 of the 2026-10-08 UI brainstorm, as scoped in the session on 2026-10-09.

- **#4 Keyboard layer:**
  - `g` then a letter jumps to a page; `n` is the page's new action; `/` its search; `?` the key list;
  - `[g e]` hints in the nav and `[key]` hints in panel borders;
  - a Settings toggle for single-key shortcuts (WCAG 2.1.4).
- **#5 TUI selection:** the selected row in inverse video with a cursor bar, and `j/k` through the Inbox, the task board and Messages.
- **#10 Multi-panel:** the user chose **keep the board and restyle it**:
  - each column becomes a titled panel with its count;
  - `j/k` moves within a column and `h/l` across columns;
  - the selected card is marked, and a footer shows `[j/k] move · [h/l] column · [enter] open · [n] new`;
  - Messages and the Inbox get titled panes with key-hint footers.

## Global Constraints

- TypeScript strict, no `any`. Run `npm run verify` before the branch is pushed.
- Glyphs are pure ASCII: no `↵`, `▌` or braille. Windows draws those from a taller fallback font. The cursor bar is CSS, and "enter" is spelt out.
- shadcn/Radix first: the key list is `ui/dialog`, and the toggle is `ui/checkbox`.
- Colours are tokens only. Every new visible pair is one already measured in `docs/accessibility.md`, or it gets measured here.
- Single-key shortcuts:
  - never fire while typing (inputs, textareas, selects, contenteditable, composition);
  - never fire with Ctrl, Meta or Alt held, or while any dialog or popover is open;
  - all of them stop when the Settings toggle is off;
  - Ctrl+K search is a modifier shortcut and stays on.
- Lean tests: about 8 new unit tests in all, no new e2e specs, and a one-off axe pass in verification.
- Incremental commits, one or more per task. No attribution lines.

## Review Focus

1. **Typing in any field.** Letters must type, not act: the task search, the chat box (mention textarea), the date picker and the new-conversation dialog. Covered by Task 2 test 1.
2. **A dialog or popover open over the page.** No jump behind it: the task detail, the create task form, the key list itself, and the assignee and date popovers. Covered by Task 2 test 1.
3. **Shortcuts turned off.** Nothing single-key fires, the hints and `aria-keyshortcuts` disappear, and Ctrl+K still works. Covered by Task 2 test 4 and Task 3.
4. **A list that re-renders under the cursor.** The Inbox poll or a board move can remove the focused row. The next `j` starts from the first row and never throws. A page with no lists ignores `j`. Covered by Task 2 test 2.
5. **Inverse selection contrast and the focus outline inside it.**
   - The selected row's text must be `primary-foreground` on `primary`, already measured in all five palettes.
   - A focused control inside it outlines in `primary-foreground`: the accent ring on an amber fill is about 1.3:1.
   - Checked by the Task 10 screenshots and the a11y doc.

---

## File Structure

| File                                                                                                                                                                | Responsibility                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `frontend/src/lib/shortcuts.ts` (+ test)                                                                                                                            | Preference store (`useShortcutsEnabled`, `setShortcutsEnabled`), `GO_TO`, `useShortcut` |
| `frontend/src/lib/key-navigation.ts`                                                                                                                                | `moveFocus("j" \| "k" \| "h" \| "l")` over `data-key-list` / `data-key-item`            |
| `frontend/src/components/layout/keyboard-shortcuts.tsx` (+ test)                                                                                                    | The document handler: `g` sequences, `n`, `/`, `?`, `j/k/h/l`                           |
| `frontend/src/components/layout/shortcut-help.tsx`                                                                                                                  | The `?` key list, a shadcn Dialog                                                       |
| `frontend/src/components/common/key-hints.tsx`                                                                                                                      | `KeyHints`: the aria-hidden `[j/k] move · …` line, shown only when shortcuts are on     |
| `frontend/src/components/common/panel.tsx`                                                                                                                          | New `keys` prop: hints drawn in the bottom border                                       |
| `frontend/src/index.css`                                                                                                                                            | `.panel-foot`, `.tui-row`, `.tui-card`                                                  |
| `frontend/src/components/layout/app-shell.tsx`                                                                                                                      | Mount the handler and the help, add the nav `[g x]` hints                               |
| `frontend/src/components/layout/status-line.tsx`                                                                                                                    | `keys` button opening the help                                                          |
| `frontend/src/routes/settings.tsx` (+ test)                                                                                                                         | Keyboard card with the toggle                                                           |
| `frontend/src/components/tasks/task-board.tsx`, `task-card.tsx`                                                                                                     | Columns as panels, cards as key items, the board footer                                 |
| `frontend/src/routes/tasks.tsx`, `events.tsx`, `messages.tsx`, `notifications.tsx`, `components/common/dashboard-search.tsx`, `components/messages/thread-chat.tsx` | Opt in to `n` / `/`, lists, and panes                                                   |
| `docs/accessibility.md`, `CLAUDE.md`                                                                                                                                | Keyboard section, contrast notes, and the opt-in convention                             |

---

### Task 1: Shortcut preference and go-to map

**Files:** Create `frontend/src/lib/shortcuts.ts` and `shortcuts.test.ts`.

**Interfaces — Produces:**

- `GO_TO: readonly { key: string; to: string; label: string }[]`
- `shortcutsEnabled(): boolean`
- `setShortcutsEnabled(on: boolean): void`
- `useShortcutsEnabled(): boolean`
- `useShortcut(key: "n" | "/"): { "data-shortcut": "n" | "/"; "aria-keyshortcuts": string | undefined }`

- [ ] Test first (`shortcuts.test.ts`, 2 tests). Reset with `setShortcutsEnabled(true)` and `localStorage.clear()` in `afterEach`.
  1. "is on until this device turns it off, and remembers that": the default is `true`; `setShortcutsEnabled(false)` then `localStorage.getItem("shortcuts") === "off"` and `shortcutsEnabled() === false`.
  2. "keeps the choice for this visit when storage is off-limits": stub `Storage.prototype.getItem` and `setItem` to throw, as `theme.test.ts` does. `setShortcutsEnabled(false)` must not throw, and `shortcutsEnabled()` must then be `false`.
- [ ] Run it and watch it fail on the missing module.
- [ ] Implement:

```ts
import { useSyncExternalStore } from "react";

/** `g` then a letter. The sidebar's hints, the key list and the handler all read this. */
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

/** On unless this device turned them off. Storage can throw; see lib/theme.ts. */
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
  return () => listeners.delete(listener);
}

export function useShortcutsEnabled(): boolean {
  return useSyncExternalStore(subscribe, shortcutsEnabled, () => true);
}

/** Makes a control the page's `n` or `/`; announced only while shortcuts are on. */
export function useShortcut(key: "n" | "/") {
  const on = useShortcutsEnabled();
  return { "data-shortcut": key, "aria-keyshortcuts": on ? key : undefined } as const;
}
```

- [ ] Run it: 2/2 pass. **Commit:** `feat(keys): add the shortcut preference and go-to map`.

### Task 2: The handler, list movement and the key list

**Files:**

- Create `frontend/src/lib/key-navigation.ts`.
- Create `frontend/src/components/layout/keyboard-shortcuts.tsx` and its test.
- Create `frontend/src/components/layout/shortcut-help.tsx`.
- Modify `app-shell.tsx` and `status-line.tsx`.

**Interfaces:**

- **Consumes:** Task 1.
- **Produces:**
  - `KeyboardShortcuts({ onHelp }: { onHelp: () => void })`
  - `ShortcutHelp({ open, onOpenChange })`
  - `moveFocus(key: "j" | "k" | "h" | "l"): boolean`
  - `StatusLine` gains `onHelp: () => void`.

- [ ] Test first (`keyboard-shortcuts.test.tsx`, 4 tests). The harness renders `KeyboardShortcuts` in a `MemoryRouter` with a `Routes` that prints the path, plus fixture markup. Keys go through `fireEvent.keyDown(document.activeElement ?? document.body, { key })`.
  1. "jumps to a page with g then its letter, but not while typing or behind a dialog":
     - `g`, `e` → the path is `/events`.
     - Focus an `<input>` and press `g`, `t` → the path is unchanged.
     - Render `<div role="dialog" data-state="open">`, press `g`, `t` from the body → unchanged.
  2. "walks a list with j/k and crosses lists with h/l": two `data-key-list="board"` lists of `data-key-item` rows, each holding a `<button>`.
     - `j` from the body focuses row 1's button; `j` → row 2; `k` → row 1.
     - `l` → the second list's row 1; `h` → back.
     - Remove the focused row and press `j` → row 1 of the first list, with no throw.
  3. "presses the page's n and focuses its / field": a `<button data-shortcut="n">` with an `onClick` spy and an `<input data-shortcut="/">`. `n` calls the spy; `/` focuses the input.
  4. "opens the key list with ?, and does nothing once single-key shortcuts are off":
     - `?` shows the dialog named "Keyboard Shortcuts" (wire `onHelp` to state that renders `ShortcutHelp`).
     - `setShortcutsEnabled(false)`, then `g`, `e` and `n` do nothing.
- [ ] Run it and watch it fail.
- [ ] Implement `lib/key-navigation.ts`:

```ts
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A row's focus target: itself if focusable, else its first focusable descendant. */
function targetOf(row: HTMLElement): HTMLElement | null {
  return row.matches(FOCUSABLE) ? row : row.querySelector<HTMLElement>(FOCUSABLE);
}

/** Rows of this list that can take focus; a nested list's rows are its own. */
function rowsOf(list: HTMLElement): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>("[data-key-item]")].filter(
    (row) => row.closest("[data-key-list]") === list && targetOf(row) !== null,
  );
}

function focusRow(row: HTMLElement) {
  const target = targetOf(row);
  if (!target) return;
  target.focus();
  target.scrollIntoView?.({ block: "nearest" });
}

/**
 * j/k move to the next/previous row of the list holding focus; h/l to the same
 * place in the previous/next list that shares its `data-key-list` value (the
 * board's columns), skipping empty ones. With focus outside any list, the
 * first row of the page's first list. Returns whether the key was used.
 */
export function moveFocus(key: "j" | "k" | "h" | "l"): boolean {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const row = active?.closest<HTMLElement>("[data-key-item]") ?? null;
  const list = row?.closest<HTMLElement>("[data-key-list]") ?? null;
  if (!row || !list) {
    const first = [...document.querySelectorAll<HTMLElement>("[data-key-list]")]
      .map(rowsOf)
      .find((rows) => rows.length > 0)?.[0];
    if (!first) return false;
    focusRow(first);
    return true;
  }
  const rows = rowsOf(list);
  const index = Math.max(rows.indexOf(row), 0);
  if (key === "j" || key === "k") {
    const next = rows[Math.min(Math.max(index + (key === "j" ? 1 : -1), 0), rows.length - 1)];
    if (next && next !== row) focusRow(next);
    return true;
  }
  const lists = [
    ...document.querySelectorAll<HTMLElement>(
      `[data-key-list="${CSS.escape(list.dataset.keyList ?? "")}"]`,
    ),
  ];
  const step = key === "l" ? 1 : -1;
  for (let at = lists.indexOf(list) + step; at >= 0 && at < lists.length; at += step) {
    const candidates = rowsOf(lists[at]!);
    if (candidates.length > 0) {
      focusRow(candidates[Math.min(index, candidates.length - 1)]!);
      break;
    }
  }
  return true;
}
```

jsdom has no `CSS.escape` or `scrollIntoView`. If the test environment lacks `CSS.escape`, guard it with `typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v`, since the values are ASCII ids. Ledger the ruling.

- [ ] Implement `keyboard-shortcuts.tsx`:
  - A `useEffect` on `[enabled, navigate, onHelp]` adds a `keydown` listener to `document`. It returns early unless `enabled`.
  - Ignore the event when any of these holds:
    - `defaultPrevented`, `isComposing`, or Ctrl, Meta or Alt is held;
    - `isTypingTarget(event.target)`: contenteditable, textarea, select, or an input whose type is not checkbox, radio, button, submit, reset, range or color;
    - `document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')` finds a match.
  - **A pending `g`:** clear its timeout. If `GO_TO` has a matching `key`, `preventDefault` and `navigate(to)`. Return.
  - **`g`:** start a 1500 ms pending timeout.
  - **`?`:** call `onHelp()`.
  - **`n` or `/`:** find `[data-shortcut=key]`. Focus it if it is an `HTMLInputElement`, otherwise `.click()` it, and `preventDefault`.
  - **`j`, `k`, `h` or `l`:** call `moveFocus`, and `preventDefault` if it returns true.
  - Clean up by removing the listener and clearing the timeout. The component renders `null`.
- [ ] Implement `shortcut-help.tsx` with `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle` "Keyboard Shortcuts" and a `DialogDescription`.
  - Three `<dl>` groups, each key in `<kbd className="border bg-secondary px-1.5 py-0.5 text-xs">`:
    - "Go to": `g o` … from `GO_TO`;
    - "On a page": `n` "the page's new action", `/` "the page's search", `?` "this list", and Ctrl K "search, on the Overview";
    - "In a list": `j`/`k` "next / previous", `h`/`l` "previous / next column", `enter` "open".
  - End with a line: "Turn single-key shortcuts off in Settings." with a `Link` to `/settings`.
- [ ] `AppShell`:
  - holds `const [helpOpen, setHelpOpen] = useState(false)`;
  - renders `<KeyboardShortcuts onHelp={openHelp} />` and `<ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />`, with `openHelp` a stable `useCallback`;
  - passes `onHelp={openHelp}` to `StatusLine`.
- [ ] `StatusLine`: after the sync text, a `·` and a `<button type="button" onClick={onHelp} aria-haspopup="dialog" aria-label="keys (keyboard shortcuts)" className="hover:text-foreground">`.
  - Its visible text is `<span aria-hidden="true">? </span>keys` when shortcuts are on, and `keys` when off.
  - Update `status-line.test.tsx` and `app-shell.test.tsx` renders for the new required prop.
- [ ] Run the new tests (4/4) and `frontend/src/components/layout` (all green).
- [ ] **Commits:** `feat(keys): jump, act and move by key across the app`, then `feat(keys): list every shortcut behind ? and the status line`.

### Task 3: The Settings toggle

**Files:** Modify `frontend/src/routes/settings.tsx` and `settings.test.tsx`.

- [ ] Test first (+1): "turns single-key shortcuts off from Settings". Click `checkbox` "Single-key shortcuts", then expect `shortcutsEnabled() === false` and `localStorage.getItem("shortcuts") === "off"`. Reset in `afterEach`.
- [ ] Watch it fail.
- [ ] Implement a "Keyboard" card after Appearance, in the same `Card` shape:
  - Description: "Shortcuts for moving around without the mouse. Press ? for the full list."
  - A `Checkbox` with `id="single-key-shortcuts"`, checked from `useShortcutsEnabled()`, and `onCheckedChange={(value) => setShortcutsEnabled(value === true)}`.
  - A `Label` reading "Single-key shortcuts".
  - A hint `<p>`: "Keys like g then t for Tasks, or n for new. Turn them off if you use speech input or they get in your way. Ctrl+K search stays on."
- [ ] Test passes. **Commit:** `feat(settings): turn single-key shortcuts off`.

### Task 4: Key hints in the nav, panel borders and footers

**Files:**

- Create `components/common/key-hints.tsx`.
- Modify `panel.tsx`, `index.css` and `app-shell.tsx`.

**Interfaces — Produces:**

- `KeyHints({ keys, className }: { keys: string[]; className?: string })`, which renders `null` when shortcuts are off;
- `Panel` gains `keys?: string[]`.

- [ ] `KeyHints`: `<p aria-hidden="true" className={cn("font-mono text-xs text-muted-foreground", className)}>{keys.join(" · ")}</p>`, only while `useShortcutsEnabled()`. Callers write the keys as `"[j/k] move"`.
- [ ] `Panel` with `keys` and shortcuts on adds a foot row after the body:

```tsx
<div aria-hidden="true" className="panel-rule panel-foot">
  <span className="panel-line w-3 shrink-0" />
  <span className="shrink-0 px-1.5 font-mono text-xs leading-none text-muted-foreground">
    {keys.join(" · ")}
  </span>
  <span className="panel-line min-w-3 flex-1" />
</div>
```

In `index.css`, inside the panel block:

```css
/* With key hints in its bottom border, the box ends at that row's midline,
     mirroring the title row. */
.panel:has(> .panel-foot)::before {
  bottom: calc(var(--panel-rule) / 2);
  border-bottom: 0;
}
```

The hint text is `muted-foreground`, straddling `background` and `card`, which is the same pair as the title meta (measured).

- [ ] Nav: in `NavigationLink`, when `!compact`, shortcuts are on and `GO_TO` has an entry for `to`, append `<span aria-hidden="true" className="font-mono text-[0.6875rem]">[g {key}]</span>`. It inherits the link's colour, so it adds no new pair. Wrap it with the unread badge in `ml-auto flex items-center gap-2`.
- [ ] Run `frontend/src/components` tests (green). **Commit:** `feat(keys): hint each shortcut in the nav and panel borders`.

### Task 5: TUI selection styles

**Files:** Modify `frontend/src/index.css`.

- [ ] Add these rules **unlayered**. Unlayered rules beat Tailwind's utilities layer, which they must, because the selected row re-inks children that carry `text-muted-foreground`.

```css
/* TUI selection (lazygit's cursor). A `.tui-row` holding keyboard focus turns
   inverse video: `primary-foreground` on `primary`, measured in every palette.
   Its text re-inks to match, except a `.tui-keep` tile that carries its own
   surface. A focused control inside outlines in the inverse ink, because the
   accent ring on an amber fill is about 1.3:1. Mouse focus does not select.
   The 3px bar is decoration: the fill carries the state. */
.tui-row {
  position: relative;
}
.tui-row:is(:focus-visible, :has(:focus-visible)) {
  background: var(--primary);
  color: var(--primary-foreground);
}
.tui-row:is(:focus-visible, :has(:focus-visible)) :not(.tui-keep, .tui-keep *) {
  color: inherit;
}
.tui-row :focus-visible {
  outline-color: var(--primary-foreground);
}
.tui-row:is(:focus-visible, :has(:focus-visible), [aria-current="true"])::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--ring);
}
/* A board card keeps its surface (its chips and priority dot are measured only
   against `card`), so selection is the cursor bar plus the accent border. */
.tui-card:has(:focus-visible) {
  border-color: var(--ring);
  box-shadow: inset 3px 0 0 var(--ring);
}
```

- [ ] Build (`npm run build -w @ctp/frontend`) and confirm the rules are in the CSS output. **Commit:** `feat(ui): draw the keyboard selection as an inverse TUI cursor`.

### Task 6: The task board as panels

**Files:** Modify `task-board.tsx`, `task-card.tsx` and `routes/tasks.tsx`.

- [ ] `BoardColumn` renders:

```tsx
<Panel level={3} title={column.label} meta={tasks.length} bodyClassName="p-2">
  <div ref={ref} data-key-list="board" className="…the existing drop-target classes…">
```

Keep the heading text exactly as the label, so the region name and the existing tests hold. The empty state stays "No tasks", now plain muted text in the panel body (drop the dashed box).

- [ ] `TaskCard`'s `Card` gets `data-key-item` and the class `tui-card`. Its first focusable element is the "Open …" overlay button, so `j/k` lands there.
- [ ] Below the board, `<KeyHints className="mt-3" keys={["[j/k] move", "[h/l] column", "[enter] open", "[n] new"]} />`. `[n] new` applies only where an `n` exists, so the board takes a `keys` prop: `/tasks` passes the full set and the event Tasks tab omits `[n] new`.
- [ ] `tasks.tsx`: the Add Tasks `Button` gets `{...useShortcut("n")}`, and the search `Input` gets `{...useShortcut("/")}`. Hooks are called at the top of the component.
- [ ] Run the `task-board`, `tasks` and `event-detail` tests (green). Fix any test that queried the old `h3` id or the dashed empty box. **Commit:** `feat(tasks): set each board column in a titled panel, walkable by key`.

### Task 7: The Inbox as a pane

**Files:** Modify `routes/notifications.tsx`.

- [ ] Replace the `<section aria-label="Notifications" className="mt-4 overflow-hidden rounded-xl border bg-card">` with:
  - `<Panel title="Notifications" meta={`${items.length} shown`} className="mt-4" bodyClassName="p-0" keys={["[j/k] move", "[enter] open"]}>`;
  - inside it, `<div data-key-list="inbox">`.
- [ ] Each row's `<article>` gets `data-key-item` and the class `tui-row`. The icon tile gets `tui-keep`. Rows with neither a link nor Mark Read are skipped by `j/k`, since there is nothing to act on; note this in the a11y doc.
- [ ] Run `notifications.test.tsx` and fix any query on the old section name. **Commit:** `feat(inbox): put the feed in a titled pane, walkable by key`.

### Task 8: Messages, Events and the Overview opt in

**Files:** Modify `routes/messages.tsx`, `components/messages/thread-chat.tsx`, `routes/events.tsx` and `components/common/dashboard-search.tsx`.

- [ ] Messages:
  - The `<nav aria-label="Conversations">` list moves into `<Panel title="Conversations" meta={unreadTotal > 0 ? `${unreadTotal} unread` : undefined} bodyClassName="p-2" keys={["[j/k] move", "[enter] open", "[n] new"]}>`. The `nav` landmark stays inside it, with `data-key-list="threads"`.
  - Each conversation button gets `data-key-item`, the class `tui-row`, and `aria-current={thread.id === active.id ? "true" : undefined}`.
  - The grid becomes two columns: the Conversations panel, and the chat in a `border bg-card` box. `ThreadChat` keeps its own header and heading.
  - "New message" gets `{...useShortcut("n")}`.
  - Add `aria-current` to an existing messages test: the opened conversation's button carries it.
- [ ] `ThreadChat`'s search `Input` gets `{...useShortcut("/")}`. It applies on Messages and on the event Thread tab, where the chat is the page's search.
- [ ] Events: the New Event link button gets `{...useShortcut("n")}`, on the `Link` via `asChild`.
- [ ] `DashboardSearch`: the trigger `Button` gets `data-shortcut="/"`. Its `aria-keyshortcuts` becomes `"Meta+K Control+K /"` while shortcuts are on.
- [ ] Run the messages, events and dashboard tests (green). **Commit:** `feat(keys): give Messages, Events and the Overview their n and / keys`.

### Task 9: Docs

- [ ] `docs/accessibility.md`, new section "Keyboard shortcuts":
  - WCAG 2.1.4 and the Settings toggle; never while typing, never in dialogs, never with modifiers;
  - `j/k` moves real focus, so screen readers follow; selection is styling on focus, with no new ARIA;
  - the inverse pair and the focus outline inside it;
  - hints are `aria-hidden`, with the full list in the `?` dialog;
  - `aria-keyshortcuts` on the `n` and `/` controls only while on;
  - Inbox rows without an action are skipped.
- [ ] `CLAUDE.md` Conventions: one bullet, **Keyboard**. A page's new action and search opt in with `useShortcut("n" | "/")`. A walkable list marks its container `data-key-list` and each row `data-key-item`. Add new go-to pages to `GO_TO`.
- [ ] **Commit:** `docs: record the keyboard layer and TUI selection`.

### Task 10: Verification

- [ ] Run `npm run verify` with the E2E member: everything green.
- [ ] Run a one-off axe pass, not committed, over `/messages` and `/notifications` in light, dark and amber, with a row focused by `j`. Expect 0 violations.
- [ ] Take screenshots of the board with a card selected, the Inbox with a row selected, and Messages with a conversation selected, in light and amber. Also screenshot the `?` dialog. Check Review Focus 5 by eye.
- [ ] Re-run the clipped-focus audit: expect 0.
- [ ] Push. Report any rulings.

---

## Amendment (2026-10-09): arrow-shaped keys and rebindable keys

The user asked for two changes: list movement on keys shaped like the arrows, which is more intuitive, and a Settings interface to change keybinds. Real arrow keys came up first, but they already scroll the page, so the user chose the arrow cluster's shape on letters instead: **W A S D**.

- **A1, bindings model** (`lib/shortcuts.ts`):
  - **Actions** `new`, `search`, `help`, `previous`, `next`, `left`, `right` and `go` default to `n`, `/`, `?`, `w`, `s`, `a`, `d` and `g`.
  - **Pages:** each `GO_TO` entry gains an `id`, and its letter is a binding.
  - **Validation:**
    - a binding is one printable character other than space, and letters are stored and matched in lower case, so Caps Lock and Shift do not break them;
    - actions are unique among actions, and pages among pages;
    - a stored set with a bad value falls back value by value, and a set that clashes reverts whole.
  - **API:** `bindings()`, `useBindings()`, `setBinding(target, key)` (returns a problem string or undefined), `resetBindings()`, `parseBindings(raw)`, `DEFAULT_BINDINGS`, `hintText(hint, bindings)` and `matchKey(event.key)`.
  - `useShortcut("new" | "search")` sets `data-shortcut` to the action and `aria-keyshortcuts` to its current key.
- **A2, handler:** it looks up the key in the bindings at event time, through `moveFocus("next" | "previous" | "left" | "right")`.
- **A3, hints:** `Panel` `keys` and `KeyHints` take hint ids (`"move" | "column" | "open" | "new"`). The nav hints, the key list and the hints are all formatted from the bindings.
- **A4, Settings:** a key-binding editor (`components/settings/key-bindings.tsx`).
  - It is a table of action, key and a Change button. Change captures the next key; Escape cancels, and leaving the button cancels.
  - A key with a modifier, or one that fails validation or clashes, is refused with a message in a `role="status"` line.
  - "Reset to defaults" restores them all.
- **Tests, kept lean:**
  - `shortcuts.test` +2: rebind, refuse and reset; fall back on bad storage.
  - `keyboard-shortcuts.test`: the list test uses W A S D and checks that a rebound key works.
  - `settings.test` +1: rebind from Settings, refused when taken.
- **Docs:** W A S D, rebinding, and the capture interface. The off switch still covers every single-key shortcut.
