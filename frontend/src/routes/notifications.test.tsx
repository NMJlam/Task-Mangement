import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationsPage } from "./notifications";
import {
  NotificationsProvider,
  pollIntervalFrom,
  useNotificationsSource,
} from "@/hooks/use-notifications";

/**
 * Mounts the page the way the app does — the feed lives on the shell and the
 * page consumes it — so the test covers the real wiring rather than a private
 * copy of the hook.
 */
function Harness() {
  const notifications = useNotificationsSource();
  return (
    <NotificationsProvider value={notifications}>
      <NotificationsPage />
    </NotificationsProvider>
  );
}

function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Harness />
    </MemoryRouter>,
  );
}

const base = {
  id: "018f3a4b-0000-7000-8000-000000000001",
  userId: "018f3a4b-0000-7000-8000-000000000002",
  kind: "task_assigned",
  body: "You were assigned Confirm venue access.",
  entityType: "task",
  entityId: "018f3a4b-0000-7000-8000-000000000003",
  readAt: null,
  createdAt: "2026-09-18T00:00:00.000Z",
};

describe("NotificationsPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("marks a row read on the click, before the server answers", async () => {
    const fetchMock = stubFeed({
      feed: { notifications: [base], unreadCount: 1 },
      markRead: new Promise(() => {}),
    });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Mark Read" }));

    expect(screen.getByText("0 unread notifications.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark Read" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`/api/notifications/${base.id}/read`, {
      method: "PATCH",
      credentials: "include",
    });
  });

  it("puts a row back to unread when marking it fails", async () => {
    stubFeed({
      feed: { notifications: [base], unreadCount: 1 },
      markRead: { ok: false, status: 503, json: async () => ({}) },
    });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Mark Read" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to mark notification as read",
    );
    expect(screen.getByText("1 unread notification.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark Read" })).toBeInTheDocument();
  });

  it("marks everything read on the click, before the server answers", async () => {
    const second = { ...base, id: "018f3a4b-0000-7000-8000-000000000009", body: "Second." };
    stubFeed({
      feed: { notifications: [base, second], unreadCount: 2 },
      markAll: new Promise(() => {}),
    });

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Mark All Read" }));

    expect(screen.getByText("0 unread notifications.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark Read" })).not.toBeInTheDocument();
  });

  describe("polling", () => {
    afterEach(() => vi.useRealTimers());

    it("picks up a new notification within a second", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const later = { ...base, id: "018f3a4b-0000-7000-8000-000000000010", body: "Arrived." };
      const fetchMock = stubFeed({ feed: { notifications: [base], unreadCount: 1 } });

      renderPage();
      await screen.findByText(base.body);
      fetchMock.feed = { notifications: [later, base], unreadCount: 2 };
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });

      expect(await screen.findByText(later.body)).toBeInTheDocument();
      expect(screen.getByText("2 unread notifications.")).toBeInTheDocument();
    });

    it("does not let a poll answered before a mark landed flash the row back", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      let land: (value: unknown) => void = () => {};
      stubFeed({
        feed: { notifications: [base], unreadCount: 1 },
        markRead: new Promise((resolve) => (land = resolve)),
      });

      renderPage();
      fireEvent.click(await screen.findByRole("button", { name: "Mark Read" }));
      // The server has not seen the mark yet, so every poll still says unread.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      expect(screen.getByText("0 unread notifications.")).toBeInTheDocument();
      land(response({ notification: { ...base, readAt: "2026-09-18T01:00:00.000Z" } }));
    });

    it("keeps rows paged in with Load More when the feed polls", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const page = Array.from({ length: 50 }, (_, index) => ({
        ...base,
        id: `018f3a4b-0000-7000-8000-${String(100 + index).padStart(12, "0")}`,
        body: `Row ${index}.`,
        createdAt: new Date(Date.UTC(2026, 8, 18) - index * 60_000).toISOString(),
      }));
      const oldest = {
        ...base,
        id: "018f3a4b-0000-7000-8000-000000000999",
        body: "From the second page.",
        createdAt: "2026-09-01T00:00:00.000Z",
      };
      stubFeed({
        feed: { notifications: page, unreadCount: 51 },
        secondPage: { notifications: [oldest], unreadCount: 51 },
      });

      renderPage();
      fireEvent.click(await screen.findByRole("button", { name: "Load More" }));
      await screen.findByText(oldest.body);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });

      expect(screen.getByText(oldest.body)).toBeInTheDocument();
    });
  });

  /**
   * `entityType`/`entityId` shipped on every row as "a deep-link target" and
   * were rendered by nothing, so each notification named a task it could not
   * open. An event has its own page, so its id goes in the link. The board has
   * no per-task URL, so a task links to the board without one: a `?task=` that
   * no page reads would look like a deep link and silently not be. And a row
   * with nothing reachable stays plain text rather than guessing.
   */
  it("links each row as far as a page can take it, and no further", async () => {
    const onEvent = {
      ...base,
      id: "018f3a4b-0000-7000-8000-000000000011",
      kind: "event_cancelled",
      body: "Semester Hackathon was cancelled.",
      entityType: "event",
    };
    const orphan = {
      ...base,
      id: "018f3a4b-0000-7000-8000-000000000012",
      body: "Welcome aboard.",
      entityType: null,
      entityId: null,
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(response({ notifications: [onEvent, base, orphan], unreadCount: 3 })),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("link", { name: onEvent.body })).toHaveAttribute(
        "href",
        `/events/${onEvent.entityId}`,
      ),
    );
    expect(screen.getByRole("link", { name: base.body })).toHaveAttribute("href", "/tasks");
    expect(screen.getByText(orphan.body)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: orphan.body })).not.toBeInTheDocument();
  });

  it("offers Load More only while a full page came back", async () => {
    // One short page: the feed is smaller than the 50-row limit, so there is
    // nothing further to ask for.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ notifications: [base], unreadCount: 1 })),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText(base.body)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Load More" })).not.toBeInTheDocument();
  });
});

it("takes a positive whole number of milliseconds as the poll interval, and a second otherwise", () => {
  expect(pollIntervalFrom("5000")).toBe(5_000);
  for (const raw of [undefined, "", "abc", "0", "-5", "1.5"]) {
    expect(pollIntervalFrom(raw)).toBe(1_000);
  }
});

/**
 * Routes by URL and method rather than by call order: the feed polls every
 * second, so a test that runs past one would hand a queued PATCH response to a
 * poll. `feed` is read on every list call, so a test can change it mid-way.
 */
function stubFeed(stubs: {
  feed: unknown;
  secondPage?: unknown;
  markRead?: unknown;
  markAll?: unknown;
}) {
  const fetchMock = Object.assign(
    vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return input.endsWith("/read-all")
          ? (stubs.markAll ?? response({ count: 0 }))
          : stubs.markRead;
      }
      if (input.includes("offset=")) return response(stubs.secondPage);
      return response(fetchMock.feed);
    }),
    { feed: stubs.feed },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function response(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
