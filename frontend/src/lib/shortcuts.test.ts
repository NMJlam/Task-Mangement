import { afterEach, expect, it, vi } from "vitest";
import { setShortcutsEnabled, shortcutsEnabled } from "./shortcuts";

afterEach(() => {
  vi.restoreAllMocks();
  setShortcutsEnabled(true);
  localStorage.clear();
});

it("is on until this device turns it off, and remembers that", () => {
  expect(shortcutsEnabled()).toBe(true);

  setShortcutsEnabled(false);

  expect(shortcutsEnabled()).toBe(false);
  expect(localStorage.getItem("shortcuts")).toBe("off");
});

it("keeps the choice for this visit when storage is off-limits", () => {
  const denied = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(denied);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(denied);

  expect(() => setShortcutsEnabled(false)).not.toThrow();
  expect(shortcutsEnabled()).toBe(false);
});
