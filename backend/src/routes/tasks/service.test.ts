import { describe, expect, it } from "vitest";
import { mergeLink, newlyAssigned, workstreamKeys } from "./service.js";

const eventA = "018f3a4b-0000-7000-8000-00000000000a";
const eventB = "018f3a4b-0000-7000-8000-00000000000b";
const teamA = "018f3a4b-0000-7000-8000-0000000000a1";
const teamB = "018f3a4b-0000-7000-8000-0000000000b1";

describe("mergeLink", () => {
  const stored = { eventId: eventA, teamId: teamA };

  it("keeps both stored sides when the patch mentions neither", () => {
    expect(mergeLink(stored, {})).toEqual(stored);
  });

  it("keeps the stored event when a patch only moves the team — the pair the composite FK checks", () => {
    expect(mergeLink(stored, { teamId: teamB })).toEqual({ eventId: eventA, teamId: teamB });
  });

  it("treats null as unlink, not as 'not mentioned'", () => {
    expect(mergeLink(stored, { eventId: null })).toEqual({ eventId: null, teamId: teamA });
  });
});

describe("workstreamKeys", () => {
  it("needs both sides — standing and event-wide tasks declare nothing", () => {
    expect(
      workstreamKeys([{ eventId: eventA, teamId: null }, { eventId: null, teamId: teamA }, {}]),
    ).toEqual([]);
  });

  it("collapses a batch to one key per (event, team) pair", () => {
    expect(
      workstreamKeys([
        { eventId: eventA, teamId: teamA },
        { eventId: eventA, teamId: teamA },
        { eventId: eventA, teamId: teamB },
        { eventId: eventB, teamId: teamA },
      ]),
    ).toEqual([
      { eventId: eventA, teamId: teamA },
      { eventId: eventA, teamId: teamB },
      { eventId: eventB, teamId: teamA },
    ]);
  });
});

describe("newlyAssigned", () => {
  const actor = "018f3a4b-0000-7000-8000-0000000000c1";
  const ann = "018f3a4b-0000-7000-8000-0000000000c2";
  const ben = "018f3a4b-0000-7000-8000-0000000000c3";

  it("names everyone on a new task but the member who assigned them", () => {
    expect(newlyAssigned([], [ann, actor, ben], actor)).toEqual([ann, ben]);
  });

  it("names only who an edit added — keeping a member on the task is not news", () => {
    expect(newlyAssigned([ann], [ann, ben], actor)).toEqual([ben]);
  });

  it("names no one when an edit only drops assignees", () => {
    expect(newlyAssigned([ann, ben], [ann], actor)).toEqual([]);
  });
});
