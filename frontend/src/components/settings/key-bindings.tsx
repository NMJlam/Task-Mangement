import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  ACTIONS,
  GO_TO,
  matchKey,
  resetBindings,
  setBinding,
  useBindings,
  type BindingTarget,
} from "@/lib/shortcuts";

type Row = { id: string; target: BindingTarget; label: string; shown: string };

/** Keys a capture waits past: pressed on their own, they are half a chord. */
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph"]);

/**
 * Settings' key-binding editor. Each row's Change button captures the next
 * key pressed on it. Escape keeps the old key, leaving the button cancels, and
 * a key that is taken or not a single character is refused, with the reason,
 * in the status line. The capture stops the key there, so the app's own
 * shortcut handler never sees it.
 */
export function KeyBindings() {
  const keys = useBindings();
  const [capturing, setCapturing] = useState<string>();
  const [message, setMessage] = useState("");

  const actionRows: Row[] = ACTIONS.map((action) => ({
    id: `action:${action.id}`,
    target: { kind: "action", id: action.id },
    label: action.label,
    shown: keys.actions[action.id],
  }));
  const pageRows: Row[] = GO_TO.map((page) => ({
    id: `page:${page.id}`,
    target: { kind: "page", id: page.id },
    label: `Go to ${page.label}`,
    shown: `${keys.actions.go} ${keys.pages[page.id]}`,
  }));

  function start(row: Row) {
    if (capturing === row.id) {
      setCapturing(undefined);
      setMessage("");
      return;
    }
    setCapturing(row.id);
    setMessage(`Press a key for ${row.label}, or Escape to keep it.`);
  }

  function capture(row: Row, event: KeyboardEvent<HTMLButtonElement>) {
    if (capturing !== row.id || MODIFIERS.has(event.key)) return;
    // Tab still moves on (and so cancels, through blur): a capture must not
    // trap the keyboard.
    if (event.key === "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setCapturing(undefined);
      setMessage(`${row.label} keeps its key.`);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      setMessage("Shortcuts are single keys, without Ctrl, Alt or Cmd.");
      return;
    }
    const problem = setBinding(row.target, event.key);
    if (problem) {
      setMessage(problem);
      return;
    }
    setCapturing(undefined);
    const key = matchKey(event.key);
    setMessage(
      `${row.label} is now ${row.target.kind === "page" ? `${keys.actions.go} ${key}` : key}.`,
    );
  }

  function table(caption: string, rows: Row[]) {
    return (
      <table className="w-full self-start text-sm">
        <caption className="pb-2 text-left text-xs tracking-[0.14em] text-muted-foreground uppercase">
          {caption}
        </caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Action</th>
            <th scope="col">Key</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const live = capturing === row.id;
            return (
              <tr key={row.id} className="border-t">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                  {row.label}
                </th>
                <td className="py-1.5 pr-3">
                  <kbd className="border bg-secondary px-1.5 py-0.5 font-mono text-xs whitespace-nowrap">
                    {row.shown}
                  </kbd>
                </td>
                <td className="py-1.5 text-right">
                  <Button
                    type="button"
                    variant={live ? "default" : "outline"}
                    size="xs"
                    aria-label={
                      live ? `Press a key for ${row.label}` : `Change key for ${row.label}`
                    }
                    onClick={() => start(row)}
                    onKeyDown={(event) => capture(row, event)}
                    onBlur={() => {
                      if (live) setCapturing(undefined);
                    }}
                  >
                    {live ? "Press a key…" : "Change"}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  return (
    <div className="mt-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {table("Actions", actionRows)}
        {table(`Go to (after ${keys.actions.go})`, pageRows)}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="min-h-5 text-sm text-muted-foreground">
          {message}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            resetBindings();
            setCapturing(undefined);
            setMessage("Every key is back to its default.");
          }}
        >
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}
