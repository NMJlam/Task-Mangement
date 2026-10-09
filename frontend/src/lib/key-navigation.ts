/**
 * `j/k/h/l` over the lists a page opts in: `data-key-list` on the container,
 * `data-key-item` on each row. Lists that share a `data-key-list` value are
 * siblings `h/l` cross — the task board's columns.
 *
 * The move is real focus, not a highlight, so a screen reader follows it and
 * Enter does what the focused control already does. Selection is just the
 * styling of the row that holds focus (`.tui-row` / `.tui-card`).
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A row's focus target: itself if focusable, else its first focusable descendant. */
function targetOf(row: HTMLElement): HTMLElement | null {
  return row.matches(FOCUSABLE) ? row : row.querySelector<HTMLElement>(FOCUSABLE);
}

/** The rows of this list that can take focus; a nested list's rows are its own. */
function rowsOf(list: HTMLElement): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>("[data-key-item]")].filter(
    (row) => row.closest("[data-key-list]") === list && targetOf(row) !== null,
  );
}

function focusRow(row: HTMLElement) {
  const target = targetOf(row);
  if (!target) return;
  target.focus();
  // Absent in jsdom; every browser has it.
  if ("scrollIntoView" in target) target.scrollIntoView({ block: "nearest" });
}

/**
 * Moves focus and says whether the key was used. With focus outside any list,
 * every key starts at the first row of the page's first list; a page with no
 * list leaves the key alone.
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
    // Clamped, not wrapped: the ends of a list are where lazygit stops too.
    const next = rows[Math.min(Math.max(index + (key === "j" ? 1 : -1), 0), rows.length - 1)];
    if (next && next !== row) focusRow(next);
    return true;
  }

  const group = list.dataset.keyList ?? "";
  const lists = [...document.querySelectorAll<HTMLElement>("[data-key-list]")].filter(
    (candidate) => candidate.dataset.keyList === group,
  );
  const step = key === "l" ? 1 : -1;
  for (let at = lists.indexOf(list) + step; at >= 0 && at < lists.length; at += step) {
    const candidates = rowsOf(lists[at]!);
    if (candidates.length > 0) {
      // The same place in the next column, or its last row if it is shorter.
      focusRow(candidates[Math.min(index, candidates.length - 1)]!);
      break;
    }
  }
  return true;
}
