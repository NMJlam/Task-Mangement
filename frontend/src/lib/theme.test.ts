import { afterEach, expect, it, vi } from "vitest";
import { saveTheme, storedTheme } from "./theme";

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

it("reads back the theme this device chose", () => {
  saveTheme("dark");
  expect(storedTheme()).toBe("dark");
});

it("falls back to light, and remembers nothing, when storage is off-limits", () => {
  denyStorage();

  expect(storedTheme()).toBe("light");
  expect(() => saveTheme("dark")).not.toThrow();
});
