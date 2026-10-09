import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsPage } from "./settings";
import { bindings, resetBindings, setShortcutsEnabled, shortcutsEnabled } from "@/lib/shortcuts";

vi.mock("@/hooks/use-me", () => ({
  useMe: () => ({
    status: "ok",
    user: {
      id: "018f3a4b-0000-7000-8000-000000000001",
      email: "member@example.com",
      role: "officer",
      tier: 0,
    },
  }),
}));

afterEach(() => {
  act(() => {
    setShortcutsEnabled(true);
    resetBindings();
  });
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-theme");
});

it("offers the five palettes, and persists and applies the one chosen", () => {
  render(<SettingsPage />);

  expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: /amber: amber phosphor/i }));

  expect(document.documentElement).toHaveClass("dark");
  expect(document.documentElement).toHaveAttribute("data-theme", "amber");
  expect(localStorage.getItem("theme")).toBe("amber");
});

it("still opens and switches theme when the browser blocks storage", () => {
  const denied = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  const reads = vi.spyOn(Storage.prototype, "getItem").mockImplementation(denied);
  const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(denied);

  try {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /dark: comfortable at night/i }));

    // Not remembered, but shown for this visit.
    expect(document.documentElement).toHaveClass("dark");
  } finally {
    reads.mockRestore();
    writes.mockRestore();
  }
});

it("turns single-key shortcuts off from Settings", () => {
  render(<SettingsPage />);

  fireEvent.click(screen.getByRole("checkbox", { name: "Single-key shortcuts" }));

  expect(shortcutsEnabled()).toBe(false);
  expect(localStorage.getItem("shortcuts")).toBe("off");
});

it("rebinds a key from Settings, and says when that key is taken", () => {
  render(<SettingsPage />);
  const change = screen.getByRole("button", { name: "Change key for New" });

  fireEvent.click(change);
  expect(change).toHaveTextContent(/press a key/i);

  fireEvent.keyDown(change, { key: "s" });
  expect(screen.getByText(/already used for Next row/i)).toBeInTheDocument();
  expect(bindings().actions.new).toBe("n");

  fireEvent.keyDown(change, { key: "b" });
  expect(bindings().actions.new).toBe("b");
  expect(screen.getByText("New is now b.")).toBeInTheDocument();
  expect(change).toHaveTextContent("Change");
});
