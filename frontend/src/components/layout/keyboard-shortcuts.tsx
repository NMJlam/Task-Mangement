import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { moveFocus } from "@/lib/key-navigation";
import { ACTIONS, bindings, GO_TO, matchKey, useShortcutsEnabled } from "@/lib/shortcuts";

/** How long `g` waits for its letter. */
const SEQUENCE_MS = 1500;

const NOT_TEXT = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color"]);

/** A field where the key is a character being typed, never a command. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !NOT_TEXT.has(target.type);
}

/**
 * A dialog or popover is up (Radix marks both `role="dialog"` with an open
 * state). A key must not act on the page hidden behind it.
 */
function overlayOpen(): boolean {
  return (
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    ) !== null
  );
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
 * - W A S D walk the page's lists (`lib/key-navigation.ts`).
 *
 * WCAG 2.1.4: none of them fire while typing, with a modifier held, over a
 * dialog, or at all once Settings turns them off.
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
      if (isTypingTarget(event.target) || overlayOpen()) return;

      const keys = bindings();
      const key = matchKey(event.key);

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

      const action = ACTIONS.find((entry) => keys.actions[entry.id] === key)?.id;
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
