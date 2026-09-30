import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { BriefingCard } from "./briefing-card";

afterEach(() => vi.unstubAllGlobals());

const respond = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function renderCard() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <BriefingCard />
    </MemoryRouter>,
  );
}

it("shows the summary and bullets with a way into the assistant", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      respond(200, {
        briefing: { summary: "A quiet day.", bullets: ["Book the room", "Chase the pizza"] },
        generatedAt: "2026-10-14T22:30:00.000Z",
      }),
    ),
  );

  renderCard();

  expect(await screen.findByText("A quiet day.")).toBeInTheDocument();
  expect(screen.getByText("Chase the pizza")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /ask the assistant/iu })).toHaveAttribute("href", "/ai");
});

it("renders nothing at all when the assistant is off", async () => {
  const fetchMock = vi.fn().mockResolvedValue(respond(503, { error: { code: "AI_DISABLED" } }));
  vi.stubGlobal("fetch", fetchMock);

  const { container } = renderCard();

  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(container).toBeEmptyDOMElement();
});
