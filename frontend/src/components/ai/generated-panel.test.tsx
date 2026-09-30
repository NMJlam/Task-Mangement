import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { GeneratedPanel } from "./generated-panel";

const RUN_ID = "018f3a4b-0000-7000-8000-000000000002";
const EVENT_ID = "018f3a4b-0000-7000-8000-000000000005";

afterEach(() => vi.unstubAllGlobals());

const task = (id: string, title: string, overrides: object = {}) => ({
  id: `018f3a4b-0000-7000-8000-0000000000${id}`,
  eventId: null,
  teamId: null,
  assigneeIds: [],
  creator: null,
  title,
  description: null,
  status: "todo",
  priority: "medium",
  dueAt: null,
  boardOrder: 0,
  minTier: 0,
  completedAt: null,
  aiRunId: null,
  createdAt: "2026-09-16T00:00:00.000Z",
  updatedAt: "2026-09-16T00:00:00.000Z",
  ...overrides,
});

const event = (id: string, title: string, aiRunId: string | null) => ({
  id,
  title,
  status: "planning",
  startsAt: "2026-11-20T08:00:00.000Z",
  endsAt: null,
  venue: null,
  minTier: 0,
  aiRunId,
  owner: null,
  taskCounts: { todo: 0, inProgress: 0, blocked: 0, done: 0 },
  overdueCount: 0,
  budget: { allocationCents: 0, committedCents: 0, spentCents: 0 },
});

function stub(tasks: unknown[], events: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.startsWith("/api/events")
        ? { items: events, nextCursor: null }
        : url === "/api/tasks"
          ? { tasks }
          : undefined;
      if (!body) throw new Error(`Unexpected request: ${url}`);
      return Promise.resolve({ ok: true, status: 200, json: async () => body });
    }),
  );
}

function renderPanel() {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <GeneratedPanel id="generated" />
    </MemoryRouter>,
  );
}

it("lists the events and tasks the assistant made, each linking to where it lives", async () => {
  stub(
    [
      task("a1", "Book the room", { aiRunId: RUN_ID, eventId: EVENT_ID }),
      task("a2", "Tidy the cupboard", { aiRunId: RUN_ID }),
      task("a3", "Made by hand"),
    ],
    [
      event(EVENT_ID, "Hack Night", RUN_ID),
      event("018f3a4b-0000-7000-8000-000000000009", "Trivia Night", null),
    ],
  );

  renderPanel();

  expect(await screen.findByRole("link", { name: "Hack Night" })).toHaveAttribute(
    "href",
    `/events/${EVENT_ID}`,
  );
  expect(screen.getByRole("link", { name: "Book the room" })).toHaveAttribute(
    "href",
    `/events/${EVENT_ID}?tab=tasks`,
  );
  expect(screen.getByRole("link", { name: "Tidy the cupboard" })).toHaveAttribute("href", "/tasks");
  // Only what the assistant made: nothing created by hand.
  expect(screen.queryByText("Made by hand")).not.toBeInTheDocument();
  expect(screen.queryByText("Trivia Night")).not.toBeInTheDocument();
});

it("says so when the assistant has made nothing yet", async () => {
  stub([task("a3", "Made by hand")], []);

  renderPanel();

  expect(await screen.findByText("Nothing generated yet.")).toBeInTheDocument();
});
