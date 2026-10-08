import { afterEach, expect, it, vi } from "vitest";
import { applyTheme, saveTheme, storedTheme } from "./theme";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

/** Storage the browser has put off-limits throws on every touch. */
function denyStorage() {
  const denied = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(denied);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(denied);
}

it("reads back any theme this build knows, and light for one it does not", () => {
  saveTheme("amber");
  expect(storedTheme()).toBe("amber");
  // A palette from a later build, or a hand-edited value.
  localStorage.setItem("theme", "neon");
  expect(storedTheme()).toBe("light");
});

it("applies a palette with the dark class and its name, and clears both on the way back", () => {
  applyTheme("gruvbox");
  expect(document.documentElement).toHaveClass("dark");
  expect(document.documentElement).toHaveAttribute("data-theme", "gruvbox");

  applyTheme("light");
  expect(document.documentElement).not.toHaveClass("dark");
  expect(document.documentElement).not.toHaveAttribute("data-theme");
});

it("falls back to light, and remembers nothing, when storage is off-limits", () => {
  denyStorage();

  expect(storedTheme()).toBe("light");
  expect(() => saveTheme("dark")).not.toThrow();
});
