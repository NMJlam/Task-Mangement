/**
 * The row and column moves (W A S D by default), on every page and in every
 * popup.
 *
 * - A page or popup marks a list with `data-key-list` on its container. Its
 *   rows are its `data-key-item` descendants, or failing those its direct
 *   children. Lists sharing a `data-key-list` value are siblings the column
 *   moves cross: the task board's columns, the Overview's panels.
 * - Up and down move between rows, keeping the column (the control's place in
 *   its row). Left and right cross to a sibling list, or, with none, move
 *   between the controls of the current row: an Inbox row's link and Mark
 *   Read, a team's two checkboxes.
 * - With a dialog or popover open, the moves stay inside it.
 * - Where there is no list (a form, a popup without one), up and down walk the
 *   controls in order.
 *
 * Moves shift real focus, so a screen reader follows and Enter does what the
 * focused control already does. Text fields are never landed on: a letter
 * pressed there must type.
 */

export type Move = "next" | "previous" | "left" | "right";

const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]";
const OVERLAY = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';
const NOT_TEXT = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color"]);

/** A field where a key is a character being typed. */
export function isTextEntry(element: HTMLElement): boolean {
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  return element instanceof HTMLInputElement && !NOT_TEXT.has(element.type);
}

/** A dialog or popover is up (Radix marks both `role="dialog"` with an open state). */
export function overlayOpen(): boolean {
  return document.querySelector(OVERLAY) !== null;
}

/**
 * The controls under `root` (itself included) a move can land on: reachable by
 * Tab, not a text field, and not hidden. Radix pairs its checkbox with an
 * `aria-hidden` input at tabindex -1, which this skips.
 */
function controlsIn(root: HTMLElement): HTMLElement[] {
  const found = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
  if (root.matches(FOCUSABLE)) found.unshift(root);
  return found.filter(
    (element) =>
      element.tabIndex >= 0 &&
      !isTextEntry(element) &&
      !element.closest('[aria-hidden="true"], [hidden], [inert]'),
  );
}

/** Where moves happen: the popup holding focus, else the open popup, else the page. */
function scopeOf(active: HTMLElement | null): HTMLElement {
  const holding = active?.closest<HTMLElement>(OVERLAY);
  if (holding) return holding;
  const open = [...document.querySelectorAll<HTMLElement>(OVERLAY)].at(-1);
  if (open) return open;
  return document.getElementById("main-content") ?? document.querySelector("main") ?? document.body;
}

/** A list's rows that have something to land on. */
function rowsOf(list: HTMLElement): HTMLElement[] {
  const explicit = [...list.querySelectorAll<HTMLElement>("[data-key-item]")].filter(
    (row) => row.closest("[data-key-list]") === list,
  );
  const rows =
    explicit.length > 0
      ? explicit
      : [...list.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
  return rows.filter((row) => controlsIn(row).length > 0);
}

/** The row of `list` that holds `element`. */
function rowOf(list: HTMLElement, element: HTMLElement): HTMLElement | null {
  const explicit = element.closest<HTMLElement>("[data-key-item]");
  if (explicit && explicit.closest("[data-key-list]") === list) return explicit;
  let node: HTMLElement | null = element;
  while (node && node.parentElement !== list) node = node.parentElement;
  return node;
}

function land(element: HTMLElement | undefined) {
  if (!element) return;
  element.focus();
  // Absent in jsdom; every browser has it.
  if ("scrollIntoView" in element) element.scrollIntoView({ block: "nearest" });
}

/** The row's control in `column`, or its last if the row is shorter. */
function landInColumn(row: HTMLElement, column: number) {
  const controls = controlsIn(row);
  land(controls[Math.min(column, controls.length - 1)]);
}

/** No list here: up and down walk the controls in order. */
function walkControls(scope: HTMLElement, active: HTMLElement | null, move: Move): boolean {
  const controls = controlsIn(scope);
  if (controls.length === 0) return false;
  const index = active ? controls.indexOf(active) : -1;
  if (index === -1) {
    land(controls[0]);
    return true;
  }
  if (move === "left" || move === "right") return false;
  const step = move === "next" ? 1 : -1;
  land(controls[Math.min(Math.max(index + step, 0), controls.length - 1)]);
  return true;
}

/**
 * Moves focus and says whether the key was used. With focus outside every
 * list, a move starts at the first row of the scope's first list.
 */
export function moveFocus(move: Move): boolean {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const scope = scopeOf(active);
  const lists = [...scope.querySelectorAll<HTMLElement>("[data-key-list]")].filter(
    (list) => rowsOf(list).length > 0,
  );
  if (lists.length === 0) return walkControls(scope, active, move);

  const holding = active?.closest<HTMLElement>("[data-key-list]");
  const list = holding && lists.includes(holding) ? holding : null;
  const row = list && active ? rowOf(list, active) : null;
  if (!list || !row || !active) {
    landInColumn(rowsOf(lists[0]!)[0]!, 0);
    return true;
  }

  const rows = rowsOf(list);
  const index = Math.max(rows.indexOf(row), 0);
  const column = Math.max(controlsIn(row).indexOf(active), 0);

  if (move === "next" || move === "previous") {
    // Clamped, not wrapped: the ends of a list are where lazygit stops too.
    const target = rows[Math.min(Math.max(index + (move === "next" ? 1 : -1), 0), rows.length - 1)];
    if (target && target !== row) landInColumn(target, column);
    return true;
  }

  const step = move === "right" ? 1 : -1;
  const siblings = lists.filter((candidate) => candidate.dataset.keyList === list.dataset.keyList);
  if (siblings.length > 1) {
    const next = siblings[siblings.indexOf(list) + step];
    if (!next) return false;
    const candidates = rowsOf(next);
    // The same place in the next list, or its last row if it is shorter.
    landInColumn(candidates[Math.min(index, candidates.length - 1)]!, column);
    return true;
  }
  const target = controlsIn(row)[column + step];
  if (!target) return false;
  land(target);
  return true;
}
