import type { Task, TaskStatus } from "@ctp/shared";
import { describe, expect, it } from "vitest";
import { byBoardOrder, reorder } from "./task-order";

const EVENT_ID = "018f3a4b-0000-7000-8000-000000000001";

function card(id: string, status: TaskStatus, boardOrder: number): Task {
  return {
    id,
    eventId: EVENT_ID,
    teamId: null,
    assigneeIds: [],
    creator: null,
    title: id,
    description: null,
    status,
    priority: "medium",
    dueAt: null,
    boardOrder,
    minTier: 0,
    completedAt: null,
    aiRunId: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
  };
}

/** One column as the board renders it: board order. */
function column(tasks: readonly Task[], status: TaskStatus) {
  return tasks
    .filter((task) => task.status === status)
    .sort(byBoardOrder)
    .map((task) => task.id);
}

function slots(tasks: readonly Task[], status: TaskStatus) {
  return tasks
    .filter((task) => task.status === status)
    .map(({ id, boardOrder }) => [id, boardOrder] as const)
    .sort((a, b) => a[1] - b[1]);
}

const board = [card("a", "todo", 0), card("b", "todo", 1), card("c", "todo", 2)];

describe("reorder", () => {
  it("drops the first card below the last", () => {
    const next = reorder(board, { id: "a", status: "todo", after: "c" });

    expect(column(next, "todo")).toEqual(["b", "c", "a"]);
    expect(slots(next, "todo")).toEqual([
      ["b", 0],
      ["c", 1],
      ["a", 2],
    ]);
  });

  it("drops the second card below the third, pushing the third up", () => {
    const next = reorder(board, { id: "b", status: "todo", after: "c" });

    expect(column(next, "todo")).toEqual(["a", "c", "b"]);
  });

  it("drops a card above an earlier one", () => {
    const next = reorder(board, { id: "c", status: "todo", after: "a" });

    expect(column(next, "todo")).toEqual(["a", "c", "b"]);
  });

  it("moves a card to the top of its own column with a null anchor", () => {
    const next = reorder(board, { id: "c", status: "todo", after: null });

    expect(column(next, "todo")).toEqual(["c", "a", "b"]);
    expect(slots(next, "todo")).toEqual([
      ["c", 0],
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("renumbers the destination of a cross-column move and leaves the rest alone", () => {
    const next = reorder([...board, card("d", "in_progress", 0)], {
      id: "b",
      status: "in_progress",
      after: "d",
    });

    expect(column(next, "in_progress")).toEqual(["d", "b"]);
    // The card left a gap where it was; the other two keep their stored slots.
    expect(slots(next, "todo")).toEqual([
      ["a", 0],
      ["c", 2],
    ]);
    expect(next.find((task) => task.id === "b")?.status).toBe("in_progress");
  });

  it("appends when the anchor is not in the destination column", () => {
    const next = reorder([...board, card("d", "done", 0)], {
      id: "a",
      status: "todo",
      after: "d",
    });

    expect(column(next, "todo")).toEqual(["b", "c", "a"]);
  });

  it("fills an empty column", () => {
    const next = reorder([...board, card("d", "done", 0)], {
      id: "d",
      status: "blocked",
      after: null,
    });

    expect(column(next, "blocked")).toEqual(["d"]);
    expect(slots(next, "blocked")).toEqual([["d", 0]]);
  });

  it("keeps the read order between slots nobody has ranked yet", () => {
    // Every slot is the column default until someone reorders, so the ties fall
    // back to the order the read returned — the board sorts nothing else.
    const unranked = [card("first", "todo", 0), card("second", "todo", 0)];
    const next = reorder(unranked, { id: "second", status: "todo", after: null });

    expect(column(unranked, "todo")).toEqual(["first", "second"]);
    expect(column(next, "todo")).toEqual(["second", "first"]);
    expect(slots(next, "todo")).toEqual([
      ["second", 0],
      ["first", 1],
    ]);
  });

  it("leaves the columns the card does not land in alone", () => {
    const done = card("d", "done", 0);
    const next = reorder([...board, done], { id: "a", status: "in_progress", after: null });

    // A column the move never touched comes back as it was…
    expect(next.find((task) => task.id === "d")).toEqual(done);
    // …and the column the card left keeps the stored slots of the cards still
    // in it: the gap where `a` was reads as nothing, because readers sort by it.
    expect(slots(next, "todo")).toEqual([
      ["b", 1],
      ["c", 2],
    ]);
    expect(column(next, "in_progress")).toEqual(["a"]);
  });
});
