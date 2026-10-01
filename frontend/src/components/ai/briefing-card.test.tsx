import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { BriefingCard } from "./briefing-card";

afterEach(() => vi.unstubAllGlobals());

type Reply = { ok: boolean; status: number; json: () => Promise<unknown> };
const respond = (status: number, body: unknown): Reply => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const today = respond(200, {
  briefing: { summary: "A quiet day.", bullets: ["Book the room", "Chase the pizza"] },
  generatedAt: "2026-10-14T22:30:00.000Z",
});

function renderCard() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <BriefingCard />
    </MemoryRouter>,
  );
}

it("shows the briefing with a way into it in AI Breakdown", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(today));

  renderCard();

  expect(await screen.findByText("A quiet day.")).toBeInTheDocument();
  expect(screen.getByText("Chase the pizza")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Your Briefing" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ask the assistant" })).toHaveAttribute(
    "href",
    "/ai/briefing",
  );
});

it("says it is preparing the briefing while it loads, rather than showing nothing", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Reply>(() => undefined)),
  );

  renderCard();

  expect(screen.getByRole("heading", { name: "Your Briefing" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Preparing your briefing…");
});

it("says it could not prepare the briefing, and tries again when asked", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      respond(503, { error: { code: "AI_UNAVAILABLE", message: "The AI service is busy." } }),
    )
    .mockResolvedValueOnce(today);
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup({ delay: null });

  renderCard();

  expect(await screen.findByText("Couldn't prepare today's briefing.")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Try again" }));

  expect(await screen.findByText("A quiet day.")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("renders nothing at all when the assistant is off", async () => {
  const fetchMock = vi.fn().mockResolvedValue(respond(503, { error: { code: "AI_DISABLED" } }));
  vi.stubGlobal("fetch", fetchMock);

  const { container } = renderCard();

  await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
