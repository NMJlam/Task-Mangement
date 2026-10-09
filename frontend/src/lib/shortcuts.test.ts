import { afterEach, expect, it, vi } from "vitest";
import {
  bindings,
  DEFAULT_BINDINGS,
  parseBindings,
  resetBindings,
  setBinding,
  setShortcutsEnabled,
  shortcutsEnabled,
} from "./shortcuts";

afterEach(() => {
  vi.restoreAllMocks();
  setShortcutsEnabled(true);
  resetBindings();
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

it("rebinds a key, refuses one that is taken or not a single key, and resets", () => {
  expect(bindings().actions.next).toBe("s");

  expect(setBinding({ kind: "action", id: "next" }, "j")).toBeUndefined();
  expect(bindings().actions.next).toBe("j");
  expect(localStorage.getItem("keybinds")).toContain('"next":"j"');

  expect(setBinding({ kind: "action", id: "new" }, "j")).toMatch(/already.*next row/i);
  expect(setBinding({ kind: "action", id: "new" }, "Enter")).toMatch(/letter/i);
  expect(setBinding({ kind: "page", id: "tasks" }, "e")).toMatch(/already.*events/i);
  expect(bindings().actions.new).toBe("n");

  resetBindings();
  expect(bindings()).toEqual(DEFAULT_BINDINGS);
});

it("falls back to the defaults for stored keys this build cannot use", () => {
  const parsed = parseBindings(
    JSON.stringify({ actions: { next: "k", new: "Enter" }, pages: { tasks: 5, events: "v" } }),
  );
  expect(parsed.actions).toMatchObject({ next: "k", new: "n" });
  expect(parsed.pages).toMatchObject({ tasks: "t", events: "v" });

  // Two actions on one key cannot both work, so that set reverts whole.
  expect(parseBindings(JSON.stringify({ actions: { new: "j", search: "j" } })).actions).toEqual(
    DEFAULT_BINDINGS.actions,
  );
  expect(parseBindings("not json")).toEqual(DEFAULT_BINDINGS);
});
