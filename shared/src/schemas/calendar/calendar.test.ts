import { describe, expect, it } from "vitest";
import { calendarItemSchema, calendarQuerySchema } from "./calendar.js";

describe("calendarQuerySchema", () => {
  it("requires from and to", () => {
    expect(calendarQuerySchema.safeParse({}).success).toBe(false);
  });

  it("splits include on comma", () => {
    const result = calendarQuerySchema.parse({
      from: "2026-01-01",
      to: "2026-01-31",
      include: "events,tasks",
    });
    expect(result.include).toEqual(["events", "tasks"]);
  });

  it("rejects an unknown include member", () => {
    expect(
      calendarQuerySchema.safeParse({ from: "2026-01-01", to: "2026-01-31", include: "clashes" })
        .success,
    ).toBe(false);
  });
});

describe("calendarItemSchema", () => {
  it("has no clashes field on either variant", () => {
    const event = calendarItemSchema.parse({
      kind: "event",
      id: "018f3a4b-0000-7000-8000-000000000001",
      title: "AGM",
      startsAt: "2026-11-01T10:00:00Z",
      endsAt: null,
      status: "planning",
    });
    expect("clashes" in event).toBe(false);
  });

  it("discriminates on kind", () => {
    const task = calendarItemSchema.parse({
      kind: "task",
      id: "018f3a4b-0000-7000-8000-000000000002",
      title: "Book venue",
      dueAt: null,
      eventId: null,
      assigneeId: null,
    });
    expect(task.kind).toBe("task");
  });
});
