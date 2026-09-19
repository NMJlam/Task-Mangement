import { describe, expect, it } from "vitest";
import {
  changeEventStatusSchema,
  createEventSchema,
  eventStatusSchema,
  eventStatusTransitions,
  getEventQuerySchema,
  taskCountsSchema,
  updateEventSchema,
} from "./event.js";

describe("eventStatusSchema", () => {
  it("accepts known statuses", () => {
    expect(eventStatusSchema.safeParse("cancelled").success).toBe(true);
  });

  it("rejects unknown statuses", () => {
    expect(eventStatusSchema.safeParse("deleted").success).toBe(false);
  });
});

describe("createEventSchema", () => {
  it("accepts the minimal shape", () => {
    const event = createEventSchema.parse({ title: "AGM", startsAt: "2026-11-01T10:00:00Z" });
    expect(event.title).toBe("AGM");
  });

  it("rejects a blank title", () => {
    expect(
      createEventSchema.safeParse({ title: "   ", startsAt: "2026-11-01T10:00:00Z" }).success,
    ).toBe(false);
  });

  it("does not itself enforce endsAt >= startsAt", () => {
    // Deliberate: that rule is assertEventDates() in the service layer, not a
    // schema .refine — see the comment on createEventSchema.
    const event = createEventSchema.parse({
      title: "AGM",
      startsAt: "2026-11-01T10:00:00Z",
      endsAt: "2026-01-01T10:00:00Z",
    });
    expect(event.endsAt).toBeInstanceOf(Date);
  });
});

describe("updateEventSchema", () => {
  it("rejects an empty patch", () => {
    expect(updateEventSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a lone endsAt", () => {
    const result = updateEventSchema.safeParse({ endsAt: "2026-12-01T10:00:00Z" });
    expect(result.success).toBe(true);
  });

  it("accepts a lone future startsAt", () => {
    // This is the case that proves assertEventDates is needed: a body-only
    // refine here could never see the stored endsAt to compare against.
    const result = updateEventSchema.safeParse({ startsAt: "2099-01-01T10:00:00Z" });
    expect(result.success).toBe(true);
  });

  it("strips teamId — rewriting workstreams is a different endpoint", () => {
    const result = updateEventSchema.safeParse({
      title: "New title",
      teamId: "018f3a4b-0000-7000-8000-000000000001",
    });
    expect(result.success).toBe(true);
    expect(result.success && "teamId" in result.data).toBe(false);
  });
});

describe("changeEventStatusSchema", () => {
  it("accepts a legal target", () => {
    expect(changeEventStatusSchema.safeParse({ status: "live" }).success).toBe(true);
  });

  it("rejects cancelled — cancelling has exactly one door, DELETE", () => {
    expect(changeEventStatusSchema.safeParse({ status: "cancelled" }).success).toBe(false);
  });
});

describe("eventStatusTransitions", () => {
  it("covers every status, so a new one cannot be added without an edge", () => {
    expect(Object.keys(eventStatusTransitions).sort()).toEqual(
      [...eventStatusSchema.options].sort(),
    );
  });

  it("never targets cancelled — DELETE owns that state", () => {
    const targets = Object.values(eventStatusTransitions).flat();
    expect(targets).not.toContain("cancelled");
  });

  it("keeps every edge inside the vocabulary the status endpoint accepts", () => {
    for (const targets of Object.values(eventStatusTransitions)) {
      for (const target of targets) {
        expect(changeEventStatusSchema.safeParse({ status: target }).success).toBe(true);
      }
    }
  });

  it("carries the planning → live → wrapped path the event page renders", () => {
    expect(eventStatusTransitions.planning).toEqual(["live"]);
    expect(eventStatusTransitions.live).toEqual(["wrapped"]);
    expect(eventStatusTransitions.wrapped).toEqual(["live"]);
  });
});

describe("taskCountsSchema", () => {
  it("has exactly four keys", () => {
    const counts = taskCountsSchema.parse({ todo: 1, inProgress: 2, blocked: 3, done: 4 });
    expect(Object.keys(counts)).toHaveLength(4);
    expect(Object.keys(counts).sort()).toEqual(["blocked", "done", "inProgress", "todo"].sort());
  });
});

describe("getEventQuerySchema / includeSchema", () => {
  it("splits a comma string", () => {
    const result = getEventQuerySchema.parse({ include: "tasks,channel" });
    expect(result.include).toEqual(["tasks", "channel"]);
  });

  it("rejects an unknown include member", () => {
    expect(getEventQuerySchema.safeParse({ include: "tasks,threads" }).success).toBe(false);
  });

  it("allows include to be omitted", () => {
    expect(getEventQuerySchema.parse({}).include).toBeUndefined();
  });
});
