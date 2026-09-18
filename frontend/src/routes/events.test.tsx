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
    // Routed by URL, not call order — `useMe` also fetches, and the page may
    // reorder its calls.
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/me") return Promise.resolve(ok({ user: me({ role: "officer", tier: 0 }) }));
      return Promise.resolve(
        url.includes("cursor=abc")
          ? ok({ items: [summary("Showcase")], nextCursor: null })
          : ok({ items: [summary("AGM")], nextCursor: "abc" }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    await waitFor(() => expect(screen.getByText("AGM")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Load More" }));

    await waitFor(() => expect(screen.getByText("Showcase")).toBeInTheDocument());
    expect(screen.getByText("AGM")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load More" })).not.toBeInTheDocument();
    expect((fetchMock.mock.calls.at(-1) as [string])[0]).toContain("cursor=abc");
  });

  it("hides the create form from tier 0 and shows it to tier 1", async () => {
    stubWithMe({ role: "officer", tier: 0 });
    renderPage();

    await waitFor(() => expect(screen.getByText(/no upcoming events/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Create Event" })).not.toBeInTheDocument();
  });

  it("posts a new event and clears the form", async () => {
    const user = userEvent.setup();
    const fetchMock = stubWithMe({ role: "director", tier: 1 });
    renderPage();

    await user.type(await screen.findByLabelText("Title"), "AGM");
    await user.type(screen.getByLabelText("Starts At"), "2026-11-01T10:00");
    await user.click(screen.getByRole("button", { name: "Create Event" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "POST",
      );
      expect(post).toBeDefined();
      expect(JSON.parse((post as [string, RequestInit])[1].body as string)).toMatchObject({
        title: "AGM",
      });
    });
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

function me(user: { role: string; tier: number }) {
  return { id: idFor("me"), email: "a@b.c", ...user };
}

/** Routes `/api/me`, the POST and the list read separately so tier can vary per test. */
function stubWithMe(user: { role: string; tier: number }) {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === "/api/me") return Promise.resolve(ok({ user: me(user) }));
    if (init?.method === "POST") return Promise.resolve(ok({ event: detail("AGM") }));
    return Promise.resolve(ok({ items: [], nextCursor: null }));
  });
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

/** `POST /api/events` answers with an EventDetail, not the list's EventSummary. */
function detail(title: string) {
  return {
    ...summary(title),
    description: null,
    attendanceEstimate: null,
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
  };
}
