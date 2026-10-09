import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { KeyboardShortcuts } from "./keyboard-shortcuts";
import { ShortcutHelp } from "./shortcut-help";
import { setShortcutsEnabled } from "@/lib/shortcuts";

afterEach(() => {
  act(() => setShortcutsEnabled(true));
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

/** Two columns of rows, the board's shape; `rows` drops rows from the first. */
function Lists({ rows = ["a1", "a2"] }: { rows?: string[] }) {
  return (
    <>
      <ul data-key-list="board">
        {rows.map((row) => (
          <li key={row} data-key-item>
            <button type="button">{row}</button>
          </li>
        ))}
      </ul>
      <ul data-key-list="board">
        <li data-key-item>
          <button type="button">b1</button>
        </li>
      </ul>
    </>
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

it("walks a list with j/k and crosses lists with h/l", () => {
  const { rerender } = render(
    <Harness>
      <Lists />
    </Harness>,
  );
  const button = (name: string) => screen.getByRole("button", { name });

  press("j");
  expect(button("a1")).toHaveFocus();
  press("j");
  expect(button("a2")).toHaveFocus();
  press("k");
  expect(button("a1")).toHaveFocus();
  press("l");
  expect(button("b1")).toHaveFocus();
  press("h");
  expect(button("a1")).toHaveFocus();

  // The focused row leaves (a poll, a move): the next j starts over.
  press("j");
  rerender(
    <Harness>
      <Lists rows={["a1"]} />
    </Harness>,
  );
  press("j");
  expect(button("a1")).toHaveFocus();
});

it("presses the page's n and focuses its / field", () => {
  const onNew = vi.fn();
  render(
    <Harness>
      <button type="button" data-shortcut="n" onClick={onNew}>
        New
      </button>
      <input aria-label="Find" data-shortcut="/" />
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
      <button type="button" data-shortcut="n" onClick={onNew}>
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
