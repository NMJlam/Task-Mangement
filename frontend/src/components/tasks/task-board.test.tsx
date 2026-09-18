import type { Task } from "@ctp/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TaskBoard } from "./task-board";

const task: Task = {
  id: "018f3a4b-0000-7000-8000-000000000002",
  eventId: "018f3a4b-0000-7000-8000-000000000001",
  teamId: null,
  assignee: "018f3a4b-0000-7000-8000-00000000000a",
  creator: null,
  title: "Confirm lighting",
  status: "todo",
  priority: "high",
  dueAt: new Date("2026-07-10T09:00:00.000Z"),
  boardOrder: 0,
  minTier: 0,
  completedAt: null,
  aiRunId: null,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-01T00:00:00.000Z"),
};

const members = [
  {
    id: "018f3a4b-0000-7000-8000-00000000000a",
    email: "ada@example.com",
    name: "Ada Lovelace",
    role: "officer" as const,
    tier: 0 as const,
    portfolio: null,
    teamIds: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  },
];

describe("TaskBoard", () => {
  it("opens a task's details in a modal and names the assignee", async () => {
    const user = userEvent.setup();
    render(<TaskBoard tasks={[task]} members={members} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /confirm lighting/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Confirm lighting" })).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("closes the modal on Escape", async () => {
    const user = userEvent.setup();
    render(<TaskBoard tasks={[task]} members={members} />);

    await user.click(screen.getByRole("button", { name: /confirm lighting/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says nobody is assigned rather than inventing a name", async () => {
    const user = userEvent.setup();
    render(<TaskBoard tasks={[{ ...task, assignee: null }]} members={members} />);

    await user.click(screen.getByRole("button", { name: /confirm lighting/i }));

    expect(await screen.findByText("Unassigned")).toBeInTheDocument();
  });
});
