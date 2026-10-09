/**
 * The moves (W A S D by default), on every page and in every popup, as a game
 * pad's D-pad does it: each key goes to the nearest control in that direction
 * on screen. Down is always down and right is always right, whatever order
 * the markup happens to be in: a board's next column, the card below, an
 * Inbox row's Mark Read beside its link, the next day on the calendar.
 *
 * - With a dialog or popover open, the moves stay inside it; otherwise they
 *   stay in the page's content.
 * - The first move, made from outside the content, lands on the first row of
 *   the page's main list (`data-key-list` on its container, its rows being its
 *   `data-key-item` descendants or, failing those, its direct children), or on
 *   the first control if the page marks none.
 * - Up or down with nothing further that way scrolls the page, as a pager does.
 *
 * Moves shift real focus, so a screen reader follows and Enter does what the
 * focused control already does. Text fields are never landed on, because a
 * letter pressed there must type, except a chat box marked `data-key-field`.
 * Once in one, the keys type, and Escape steps back to where the move came
 * from (`leaveField`).
 */

/** Down, up, left and right. */
export type Move = "next" | "previous" | "left" | "right";

const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]";
const OVERLAY = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';
const NOT_TEXT = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color"]);

/** How far up and down scroll when there is nothing further that way: a few lines. */
const SCROLL_STEP = 80;

/**
 * A field where a key is a character being typed. A `<select>` is not one: it
 * is a control the moves land on and step past. Its type-ahead would otherwise
 * turn a move key into a choice, such as "s" picking the first option that
 * starts with S. The handler cancels the key, so it never gets that far.
 */
export function isTextEntry(element: HTMLElement): boolean {
  if (element.isContentEditable || element instanceof HTMLTextAreaElement) return true;
  return element instanceof HTMLInputElement && !NOT_TEXT.has(element.type);
}

/** A dialog or popover is up (Radix marks both `role="dialog"` with an open state). */
export function overlayOpen(): boolean {
  return document.querySelector(OVERLAY) !== null;
}

/**
 * Where a control sits on screen. A link that stretches its hit area over a
 * row or card (`data-key-stretch`, drawn with an `after:` layer over its
 * positioned ancestor) is measured as that row: it is what the eye and the
 * mouse see, while the link's own box is just its title text.
 */
function rectOf(element: HTMLElement): DOMRect {
  const box = element.hasAttribute("data-key-stretch") ? element.offsetParent : null;
  return (box instanceof HTMLElement ? box : element).getBoundingClientRect();
}

/**
 * The controls under `root` (itself included) a move can land on: reachable by
 * Tab, not a text field, not hidden, and drawn. Radix pairs its checkbox with
 * an `aria-hidden` input at tabindex -1, which this skips.
 */
function controlsIn(root: HTMLElement): HTMLElement[] {
  const found = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
  if (root.matches(FOCUSABLE)) found.unshift(root);
  return found.filter((element) => {
    if (element.tabIndex < 0) return false;
    if (isTextEntry(element) && !element.hasAttribute("data-key-field")) return false;
    if (element.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
    const box = rectOf(element);
    return box.width > 0 && box.height > 0;
  });
}

/** Where moves happen: the popup holding focus, else the open popup, else the page. */
function scopeOf(active: HTMLElement | null): HTMLElement {
  const holding = active?.closest<HTMLElement>(OVERLAY);
  if (holding) return holding;
  const open = [...document.querySelectorAll<HTMLElement>(OVERLAY)].at(-1);
  if (open) return open;
  return document.getElementById("main-content") ?? document.querySelector("main") ?? document.body;
}

/** Where a first move lands: the first row of the scope's first marked list. */
function entryOf(scope: HTMLElement, controls: HTMLElement[]): HTMLElement | undefined {
  const lists = [...scope.querySelectorAll<HTMLElement>("[data-key-list]")];
  // The scope can be a list itself: a popover marks its own content.
  if (scope.matches("[data-key-list]")) lists.unshift(scope);
  for (const list of lists) {
    const explicit = [...list.querySelectorAll<HTMLElement>("[data-key-item]")].filter(
      (row) => row.closest("[data-key-list]") === list,
    );
    const rows =
      explicit.length > 0
        ? explicit
        : [...list.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
    for (const row of rows) {
      const first = controls.find((control) => row === control || row.contains(control));
      if (first) return first;
    }
  }
  return controls[0];
}

/**
 * The control nearest to `from` in the direction of `move`.
 *
 * - A candidate must lie beyond `from`'s facing edge, so a control inside a
 *   card is not "right of" the card.
 * - Left and right stay on the row: a candidate must sit level with `from`,
 *   within its own height, or the move goes nowhere rather than jumping to a
 *   far corner. The exception is a chat box in that direction, within a pane's
 *   reach: from Messages' conversations or the AI chats, right goes into the
 *   box to write in, wherever it sits.
 * - The score is the gap plus twice the sideways distance: none for a control
 *   that overlaps `from`'s column (or row), else the distance between centres.
 *   So whatever is squarely below wins, wide or narrow, over a nearer one off
 *   in the next column.
 */
function nearest(from: DOMRect, candidates: HTMLElement[], move: Move): HTMLElement | undefined {
  const vertical = move === "next" || move === "previous";
  const fromX = from.left + from.width / 2;
  const fromY = from.top + from.height / 2;
  const gapTo = (box: DOMRect) =>
    move === "next"
      ? box.top - from.bottom
      : move === "previous"
        ? from.top - box.bottom
        : move === "right"
          ? box.left - from.right
          : from.left - box.right;
  if (!vertical) {
    const reach = Math.max(from.width, 160) * 2;
    const boxes = candidates.filter((candidate) => {
      if (!candidate.hasAttribute("data-key-field")) return false;
      const gap = gapTo(rectOf(candidate));
      return gap >= -1 && gap <= reach;
    });
    if (boxes.length > 0) candidates = boxes;
  }
  let best: HTMLElement | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const box = rectOf(candidate);
    const gap = gapTo(box);
    if (gap < -1) continue;
    const field = candidate.hasAttribute("data-key-field");
    if (
      !vertical &&
      !field &&
      (box.bottom < from.top - from.height || box.top > from.bottom + from.height)
    ) {
      continue;
    }
    const overlaps = vertical
      ? box.left < from.right && box.right > from.left
      : box.top < from.bottom && box.bottom > from.top;
    const sideways = overlaps
      ? 0
      : vertical
        ? Math.abs(box.left + box.width / 2 - fromX)
        : Math.abs(box.top + box.height / 2 - fromY);
    const score = Math.max(gap, 0) + sideways * 2;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/** Where a move (or `/`) into a box came from, for Escape to return to. */
let cameFrom: HTMLElement | null = null;

/**
 * Focuses a box the keys can type into, remembering where focus was so Escape
 * can step back there. Used by the moves and by the search key.
 */
export function enterField(field: HTMLElement) {
  const from = document.activeElement;
  cameFrom = from instanceof HTMLElement && from !== document.body && from !== field ? from : null;
  field.focus();
}

function land(element: HTMLElement) {
  if (element.hasAttribute("data-key-field")) {
    enterField(element);
  } else {
    element.focus();
  }
  // Absent in jsdom; every browser has it.
  if ("scrollIntoView" in element) element.scrollIntoView({ block: "nearest" });
}

/** Moves focus and says whether the key was used. */
export function moveFocus(move: Move): boolean {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const scope = scopeOf(active);
  const controls = controlsIn(scope);
  const vertical = move === "next" || move === "previous";
  const inPage = scope.closest(OVERLAY) === null;

  if (!active || !controls.includes(active)) {
    const entry = entryOf(scope, controls);
    if (entry) {
      land(entry);
      return true;
    }
  } else {
    const target = nearest(
      rectOf(active),
      controls.filter((control) => !control.contains(active) && !active.contains(control)),
      move,
    );
    if (target) {
      land(target);
      return true;
    }
  }

  // Nothing (further) that way: up and down page through the content.
  if (!vertical || !inPage) return false;
  window.scrollBy({ top: move === "next" ? SCROLL_STEP : -SCROLL_STEP });
  return true;
}

/**
 * Escape in a box: back to the control the move (or `/`) came from, or, if
 * that has gone, the nearest control above, left, below or right of the box.
 * With none at all, focus just leaves the box, so the moves work again.
 */
export function leaveField(field: HTMLElement): boolean {
  const scope = scopeOf(field);
  const controls = controlsIn(scope).filter(
    (control) => control !== field && !control.hasAttribute("data-key-field"),
  );
  const box = rectOf(field);
  const back =
    cameFrom && cameFrom.isConnected && controls.includes(cameFrom)
      ? cameFrom
      : (nearest(box, controls, "previous") ??
        nearest(box, controls, "left") ??
        nearest(box, controls, "next") ??
        nearest(box, controls, "right"));
  cameFrom = null;
  if (back) land(back);
  else field.blur();
  return true;
}
