import type { AiResolvedProposal, RosterMember } from "@ctp/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProposalCard } from "./proposal-card";

const TASK_ID = "0192f1a0-0000-7000-8000-000000000001";
const BEN = "0192f1a0-0000-7000-8000-00000000000b";
const ANN = "0192f1a0-0000-7000-8000-00000000000c";

const members: RosterMember[] = [];
const roster: RosterMember[] = [
  {
    id: BEN,
    role: "officer",
    tier: 0,
    createdAt: new Date("2026-01-01"),
    name: "Ben Okafor",
    email: "ben@example.com",
    teamIds: [],
    portfolio: null,
  },
  {
    id: ANN,
    role: "officer",
    tier: 0,
    createdAt: new Date("2026-01-01"),
    name: "Ann Lee",
    email: "ann@example.com",
    teamIds: [],
    portfolio: null,
  },
];

const plan: AiResolvedProposal = {
  createEvent: { ref: "$event1", title: "Hack Night", startsAt: new Date("2026-11-20T08:00:00Z") },
  createTasks: [
    { title: "Book room", priority: "medium", dueAt: null, assignees: [], eventRef: "$event1" },
    { title: "Order pizza", priority: "high", dueAt: null, assignees: [], eventRef: "$event1" },
  ],
  updateTasks: [
    {
      id: TASK_ID,
      title: "Poster",
      diffs: [{ field: "assignees", before: "Ann", after: "Ben" }],
      assigneeIds: [BEN],
    },
  ],
};

function renderCard(
  onApply = vi.fn(),
  proposal: AiResolvedProposal = plan,
  rosterMembers: RosterMember[] = members,
) {
  render(
    <ProposalCard
      proposal={proposal}
      members={rosterMembers}
      onApply={onApply}
      onDiscard={vi.fn()}
    />,
  );
  return { onApply, user: userEvent.setup({ delay: null }) };
}

const include = (name: string) => screen.getByRole("checkbox", { name: `Include ${name}` });
const footer = () => screen.getByRole("button", { name: /^(Create|Apply)/u });

describe("ProposalCard", () => {
  it("renders every proposed row, each checked by default", () => {
    renderCard();

    for (const name of ["Hack Night", "Book room", "Order pizza", "Poster"]) {
      expect(include(name)).toBeChecked();
    }
    expect(screen.getByText("Reassign tasks")).toBeInTheDocument();
  });

  it("names what the footer will do, and recounts as rows are unchecked", async () => {
    const { user } = renderCard();
    expect(footer()).toHaveTextContent("Apply 4 changes");

    await user.click(include("Poster"));

    expect(footer()).toHaveTextContent("Create 1 event + 2 tasks");
  });

  it("disables a staged event's tasks once the event is unchecked", async () => {
    const { user } = renderCard();

    await user.click(include("Hack Night"));

    expect(include("Book room")).toBeDisabled();
    expect(include("Order pizza")).toBeDisabled();
    expect(footer()).toHaveTextContent("Apply 1 change");
  });

  it("blocks the footer while a checked row is invalid", async () => {
    const { user } = renderCard();
    const row = screen.getByRole("group", { name: "Book room" });

    await user.clear(within(row).getByLabelText("Title"));

    expect(footer()).toBeDisabled();
    expect(within(row).getByText("Title is required")).toBeInTheDocument();
  });

  it("applies the checked rows, with the ids a reassignment needs and one edit counted", async () => {
    const { user, onApply } = renderCard();
    const row = screen.getByRole("group", { name: "Order pizza" });
    await user.clear(within(row).getByLabelText("Title"));
    await user.type(within(row).getByLabelText("Title"), "Order snacks");

    await user.click(footer());

    const [operations, stats] = onApply.mock.calls[0]!;
    expect(stats).toEqual({ proposed: 4, kept: 4, edited: 1 });
    expect(operations).toContainEqual({
      op: "update",
      entity: "task",
      id: TASK_ID,
      data: { assigneeIds: [BEN] },
    });
    expect(operations).toContainEqual(
      expect.objectContaining({
        op: "create",
        entity: "task",
        data: expect.objectContaining({ title: "Order snacks", eventRef: "$event1" }),
      }),
    );
  });

  it("changes who a task is assigned to through its + picker", async () => {
    const assigned: AiResolvedProposal = {
      createTasks: [
        {
          title: "Book room",
          priority: "medium",
          dueAt: null,
          assignees: [{ id: BEN, name: "Ben Okafor" }],
        },
      ],
    };
    const { user, onApply } = renderCard(vi.fn(), assigned, roster);

    await user.click(screen.getByRole("button", { name: "Add member to Book room" }));

    // Whoever holds the task can be taken off it, and a colleague put on.
    await user.click(await screen.findByRole("button", { name: "Remove Ben Okafor" }));
    await user.click(screen.getByRole("button", { name: "Assign Ann Lee" }));

    expect(
      within(screen.getByRole("list", { name: "Assignees for Book room" })).getByText("Ann Lee"),
    ).toBeInTheDocument();

    await user.click(footer());

    const [operations] = onApply.mock.calls[0]!;
    expect(operations).toContainEqual({
      op: "create",
      entity: "task",
      data: expect.objectContaining({ title: "Book room", assigneeIds: [ANN] }),
    });
  });
});
