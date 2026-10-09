import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { isTextEntry, moveFocus, overlayOpen, type Move } from "@/lib/key-navigation";
import { ACTIONS, bindings, GO_TO, matchKey, useShortcutsEnabled } from "@/lib/shortcuts";

/** How long `g` waits for its letter. */
const SEQUENCE_MS = 1500;

const MOVES = new Set<string>(["next", "previous", "left", "right"]);

/** Widgets that use letters themselves, for type-ahead. */
const OWNS_LETTERS =
  '[role="listbox"], [role="menu"], [role="menubar"], [role="combobox"], [role="tree"]';

/** A key that must reach its target as typing, or as the widget's own key. */
function keepsKey(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return isTextEntry(target) || target.closest(OWNS_LETTERS) !== null;
}

/**
 * The app's single-key shortcuts, on one document listener. The keys are the
 * bindings (`lib/shortcuts.ts`), read at each keypress so a rebind in Settings
 * takes effect at once; the defaults are:
 *
 * - `g` then a page's letter jumps to it (`GO_TO`);
 * - `n` presses the page's `[data-shortcut="new"]`;
 * - `/` focuses (or presses) the page's `[data-shortcut="search"]`;
 * - `?` opens the key list;
 * - W A S D walk the page's lists, or a popup's (`lib/key-navigation.ts`).
 *
 * WCAG 2.1.4: none of them fire while typing, with a modifier held, or at all
 * once Settings turns them off. Over a dialog or popover only the moves work,
 * and only inside it, so no key acts on the page hidden behind it.
 */
export function KeyboardShortcuts({ onHelp }: { onHelp: () => void }) {
  const enabled = useShortcutsEnabled();
  const navigate = useNavigate();

  useEffect(() => {
    if (!enabled) return;
    let pending: number | undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (keepsKey(event.target)) return;

      const keys = bindings();
      const key = matchKey(event.key);
      const action = ACTIONS.find((entry) => keys.actions[entry.id] === key)?.id;

      if (overlayOpen()) {
        window.clearTimeout(pending);
        pending = undefined;
        if (action && MOVES.has(action) && moveFocus(action as Move)) event.preventDefault();
        return;
      }

      if (pending !== undefined) {
        window.clearTimeout(pending);
        pending = undefined;
        const destination = GO_TO.find((page) => keys.pages[page.id] === key);
        if (destination) {
          event.preventDefault();
          navigate(destination.to);
        }
        return;
      }

      switch (action) {
        case "go":
          pending = window.setTimeout(() => {
            pending = undefined;
          }, SEQUENCE_MS);
          return;
        case "help":
          event.preventDefault();
          onHelp();
          return;
        case "new":
        case "search": {
          const control = document.querySelector<HTMLElement>(`[data-shortcut="${action}"]`);
          if (!control) return;
          event.preventDefault();
          if (control instanceof HTMLInputElement) control.focus();
          else control.click();
          return;
        }
        case "next":
        case "previous":
        case "left":
        case "right":
          if (moveFocus(action)) event.preventDefault();
          return;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(pending);
    };
  }, [enabled, navigate, onHelp]);

  return null;
}
