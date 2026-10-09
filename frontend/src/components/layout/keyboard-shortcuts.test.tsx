import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KeyboardShortcuts } from "./keyboard-shortcuts";
import { ShortcutHelp } from "./shortcut-help";
import { resetBindings, setBinding, setShortcutsEnabled } from "@/lib/shortcuts";

/**
 * jsdom draws nothing, so each control here states its box on screen as
 * `data-box="left top width height"`; anything without one is not drawn.
 */
beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const box = this instanceof HTMLElement ? (this.dataset.box ?? "") : "";
    const [left = 0, top = 0, width = 0, height = 0] = box.split(" ").map(Number);
    return {
      left,
      top,
      width,
      height,
      x: left,
      y: top,
      right: left + width,
      bottom: top + height,
      toJSON: () => ({}),
    };
  });
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  act(() => {
    setShortcutsEnabled(true);
    resetBindings();
  });
  localStorage.clear();
});

function Path() {
  return <p data-testid="path">{useLocation().pathname}</p>;
}

/** The shell's wiring: the handler, the key list it opens, and the page. */
function Harness({ children }: { children?: ReactNode }) {
  const [help, setHelp] = useState(false);
  return (
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <KeyboardShortcuts onHelp={() => setHelp(true)} />
      <ShortcutHelp open={help} onOpenChange={setHelp} />
      <Routes>
        <Route path="*" element={<Path />} />
      </Routes>
      {children}
    </MemoryRouter>
  );
}

function press(...keys: string[]) {
  for (const key of keys) fireEvent.keyDown(document.activeElement ?? document.body, { key });
}

const GRID_BOXES: Record<string, string> = {
  Light: "0 0 100 40",
  Dark: "120 0 100 40",
  Amber: "0 50 100 40",
  Green: "120 50 100 40",
};

/** A two-column grid in reading order, the Settings themes' shape. */
function Grid({ names = ["Light", "Dark", "Amber", "Green"] }: { names?: string[] }) {
  return (
    <div data-key-list>
      {names.map((name) => (
        <button key={name} type="button" data-box={GRID_BOXES[name]}>
          {name}
        </button>
      ))}
    </div>
  );
}

it("jumps to a page with g then its letter, but not while typing or behind a dialog", () => {
  const { rerender } = render(
    <Harness>
      <input aria-label="Search" />
    </Harness>,
  );
  const path = screen.getByTestId("path");

  press("g", "e");
  expect(path).toHaveTextContent("/events");

  screen.getByRole("textbox", { name: "Search" }).focus();
  press("g", "t");
  expect(path).toHaveTextContent("/events");

  screen.getByRole("textbox", { name: "Search" }).blur();
  rerender(
    <Harness>
      <div role="dialog" data-state="open" />
    </Harness>,
  );
  press("g", "t");
  expect(path).toHaveTextContent("/events");
});

it("moves to what is below, beside or above on screen, on whatever keys are bound", () => {
  const { rerender } = render(
    <Harness>
      <Grid />
    </Harness>,
  );
  const button = (name: string) => screen.getByRole("button", { name });

  press("s");
  expect(button("Light")).toHaveFocus();
  press("s"); // down is down, not the next in the markup (Dark)
  expect(button("Amber")).toHaveFocus();
  press("d");
  expect(button("Green")).toHaveFocus();
  press("W"); // Caps Lock or Shift still reaches it
  expect(button("Dark")).toHaveFocus();
  press("a");
  expect(button("Light")).toHaveFocus();

  // Rebound in Settings: the new key moves, the old one no longer does.
  act(() => void setBinding({ kind: "action", id: "next" }, "j"));
  press("s");
  expect(button("Light")).toHaveFocus();
  press("j");
  expect(button("Amber")).toHaveFocus();

  // The focused control leaves (a poll, a move): the next move starts over.
  rerender(
    <Harness>
      <Grid names={["Light", "Dark", "Green"]} />
    </Harness>,
  );
  press("j");
  expect(button("Light")).toHaveFocus();
});

it("presses the page's new action and focuses its search", () => {
  const onNew = vi.fn();
  render(
    <Harness>
      <button type="button" data-shortcut="new" onClick={onNew}>
        New
      </button>
      <input aria-label="Find" data-shortcut="search" />
    </Harness>,
  );

  press("n");
  expect(onNew).toHaveBeenCalledOnce();
  press("/");
  expect(screen.getByRole("textbox", { name: "Find" })).toHaveFocus();
});

it("opens the key list with ?, and does nothing once single-key shortcuts are off", () => {
  const onNew = vi.fn();
  render(
    <Harness>
      <button type="button" data-shortcut="new" onClick={onNew}>
        New
      </button>
    </Harness>,
  );

  press("?");
  expect(screen.getByRole("dialog", { name: "Keyboard Shortcuts" })).toBeInTheDocument();
  press("Escape");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  act(() => setShortcutsEnabled(false));
  press("g", "e", "n", "?");
  expect(screen.getByTestId("path")).toHaveTextContent("/");
  expect(screen.getByTestId("path")).not.toHaveTextContent("/events");
  expect(onNew).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("moves inside an open popup only, and steps past text fields and selects", () => {
  const { rerender } = render(
    <Harness>
      <button type="button" data-box="0 200 100 20">
        Behind the popup
      </button>
      {/* The list on the popup itself, as Edit teams marks its popover. */}
      <div role="dialog" data-state="open" aria-label="Edit teams" data-key-list>
        <p>Teams</p>
        <div>
          <button type="button" data-box="0 0 80 20">
            Design
          </button>
          <button type="button" data-box="100 0 80 20">
            Lead of Design
          </button>
        </div>
        <div>
          <button type="button" data-box="0 30 80 20">
            Events
          </button>
          <button type="button" data-box="100 30 80 20">
            Lead of Events
          </button>
        </div>
      </div>
    </Harness>,
  );
  const button = (name: string) => screen.getByRole("button", { name });

  press("s");
  expect(button("Design")).toHaveFocus();
  press("d");
  expect(button("Lead of Design")).toHaveFocus();
  press("s");
  expect(button("Lead of Events")).toHaveFocus();
  press("a");
  expect(button("Events")).toHaveFocus();
  press("s"); // nothing below in the popup, and the page behind is off-limits
  expect(button("Events")).toHaveFocus();

  // A form: the moves step over its text field. A select is stepped past
  // too, and the key never reaches it: its type-ahead would otherwise pick
  // the option starting with "s".
  rerender(
    <Harness>
      <a href="/events" data-box="0 0 60 20">
        Back
      </a>
      <input aria-label="Title" data-box="0 30 200 20" />
      <select aria-label="Event" defaultValue="" data-box="0 60 200 20">
        <option value="">No event</option>
        <option value="s">Semester Expo</option>
      </select>
      <button type="button" data-box="0 90 60 20">
        Save
      </button>
    </Harness>,
  );
  press("s");
  expect(screen.getByRole("link", { name: "Back" })).toHaveFocus();
  press("s");
  const select = screen.getByRole("combobox", { name: "Event" });
  expect(select).toHaveFocus();
  expect(fireEvent.keyDown(select, { key: "s" })).toBe(false); // default prevented
  expect(button("Save")).toHaveFocus();
});

it("moves into a chat box, leaves the keys to typing there, and steps back out on Escape", () => {
  render(
    <Harness>
      <button type="button" data-box="0 0 100 20">
        Logistics
      </button>
      {/* Level with the conversation, but the box below it is where D goes. */}
      <a href="/events/1" data-box="140 0 80 20">
        View event
      </a>
      <input aria-label="Search messages" data-box="240 0 100 20" />
      <textarea aria-label="Write a message" data-key-field data-box="120 300 220 60" />
    </Harness>,
  );
  const conversation = screen.getByRole("button", { name: "Logistics" });
  const box = screen.getByRole("textbox", { name: "Write a message" });

  conversation.focus();
  press("d");
  expect(box).toHaveFocus();
  press("a", "s"); // typing now, not moving
  expect(box).toHaveFocus();
  press("Escape");
  expect(conversation).toHaveFocus();
});
