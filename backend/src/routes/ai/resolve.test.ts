import { describe, expect, it } from "vitest";
import { dueAtFromOffset } from "./resolve.js";

const MELBOURNE = "Australia/Melbourne";

describe("dueAtFromOffset", () => {
  it("lands at 23:59 club time on the event's local day, shifted by the offset", () => {
    // 10:00 AEST, Friday 11 September 2026 — AEST is UTC+10.
    const startsAt = new Date("2026-09-11T00:00:00Z");

    expect(dueAtFromOffset(startsAt, -3, MELBOURNE)).toEqual(new Date("2026-09-08T13:59:00Z"));
  });

  it("counts from the club's calendar day, not UTC's, for an evening event", () => {
    // 20:00 AEST on 11 September is still 10 September in UTC; an offset of 0
    // must mean the 11th, the day the committee thinks the event is on.
    const startsAt = new Date("2026-09-11T10:00:00Z");

    expect(dueAtFromOffset(startsAt, 0, MELBOURNE)).toEqual(new Date("2026-09-11T13:59:00Z"));
  });

  it("uses the offset in force on the due day across a daylight-saving change", () => {
    // Melbourne moves to AEDT (UTC+11) on Sunday 4 October 2026. An event on the
    // 8th with a -7 offset is due on 1 October, still AEST (UTC+10).
    const startsAt = new Date("2026-10-08T00:00:00Z");

    expect(dueAtFromOffset(startsAt, -7, MELBOURNE)).toEqual(new Date("2026-10-01T13:59:00Z"));
    expect(dueAtFromOffset(startsAt, 0, MELBOURNE)).toEqual(new Date("2026-10-08T12:59:00Z"));
  });
});
