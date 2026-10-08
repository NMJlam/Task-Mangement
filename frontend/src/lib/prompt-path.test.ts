import { describe, expect, it } from "vitest";
import { promptPath, syncAge } from "./prompt-path";

const id = "018f3a4b-0000-7000-8000-00000000a1b2";

describe("promptPath", () => {
  it("is ~ at the root, and the path below it elsewhere", () => {
    expect(promptPath("/", "")).toBe("~");
    expect(promptPath("/events", "")).toBe("~/events");
    expect(promptPath("/events/", "")).toBe("~/events");
  });

  it("shortens an id to its last eight digits — v7 ids from one minute share their first eight", () => {
    expect(promptPath(`/events/${id}`, "")).toBe("~/events/0000a1b2");
  });

  it("walks into the open tab and the open thread, and ignores other parameters", () => {
    expect(promptPath(`/events/${id}`, "?tab=thread")).toBe("~/events/0000a1b2/thread");
    expect(promptPath("/messages", `?thread=${id}`)).toBe("~/messages/0000a1b2");
    expect(promptPath("/tasks", "?scope=mine")).toBe("~/tasks");
  });
});

describe("syncAge", () => {
  it.each([
    [400, "just now"],
    [1_000, "1s ago"],
    [59_999, "59s ago"],
    [60_000, "1m ago"],
    [3_600_000, "1h ago"],
  ])("%ims → %s", (ms, text) => {
    expect(syncAge(ms)).toBe(text);
  });
});
