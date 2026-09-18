import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventsPage } from "./events";

describe("EventsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the empty state when there are no events", async () => {
    stubFetch({ items: [], nextCursor: null });
    renderPage();

    await waitFor(() => expect(screen.getByText(/no upcoming events/i)).toBeInTheDocument());
  });

  it("renders a card per event when the list is non-empty", async () => {
    stubFetch({ items: [summary("AGM")], nextCursor: null });
    renderPage();

    await waitFor(() => expect(screen.getByText("AGM")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "AGM" })).toHaveAttribute(
      "href",
      `/events/${idFor("AGM")}`,
    );
    expect(screen.queryByText(/no upcoming events/i)).not.toBeInTheDocument();
  });

  it("shows an actionable error when the API returns an HTML error page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token '<'")),
      }),
    );
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load events: Failed to load events. Refresh the page to try again.",
    );
  });

  it("asks the API for upcoming events by default", async () => {
    const fetchMock = stubFetch({ items: [], nextCursor: null });
    renderPage();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/api/events?");
    expect(url).toContain("from=");
    expect(url).not.toContain("to=");
  });

  it("swaps from= for to= when the reader asks for past events", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch({ items: [], nextCursor: null });
    renderPage();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Past" }));

    await waitFor(() => {
      const [url] = fetchMock.mock.calls.at(-1) as [string];
      expect(url).toContain("to=");
      expect(url).not.toContain("from=");
    });
  });

  it("passes the chosen status through, cancelled included", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch({ items: [], nextCursor: null });
    renderPage();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText("Status"), "cancelled");

    await waitFor(() => {
      const [url] = fetchMock.mock.calls.at(-1) as [string];
      expect(url).toContain("status=cancelled");
    });
  });

  it("appends the next page and hides the button at the end of the list", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ items: [summary("AGM")], nextCursor: "abc" }))
      .mockResolvedValueOnce(ok({ items: [summary("Showcase")], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await waitFor(() => expect(screen.getByText("AGM")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Load More" }));

    await waitFor(() => expect(screen.getByText("Showcase")).toBeInTheDocument());
    expect(screen.getByText("AGM")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load More" })).not.toBeInTheDocument();
    expect((fetchMock.mock.calls.at(-1) as [string])[0]).toContain("cursor=abc");
  });
});

function renderPage() {
  render(
    <MemoryRouter>
      <EventsPage />
    </MemoryRouter>,
  );
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function stubFetch(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(ok(body));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function idFor(title: string) {
  return `018f3a4b-0000-7000-8000-${title.length.toString().padStart(12, "0")}`;
}

function summary(title: string) {
  return {
    id: idFor(title),
    title,
    status: "planning",
    startsAt: "2026-11-01T10:00:00.000Z",
    endsAt: null,
    venue: null,
    minTier: 0,
    owner: null,
    taskCounts: { todo: 0, inProgress: 0, blocked: 0, done: 0 },
    overdueCount: 0,
    budget: { allocationCents: 0, committedCents: 0, spentCents: 0 },
  };
}
