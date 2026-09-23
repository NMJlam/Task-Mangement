import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationsPage } from "./notifications";
import { NotificationsProvider, useNotificationsSource } from "@/hooks/use-notifications";

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

  it("shows unread notifications and marks one as read", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ notifications: [base], unreadCount: 1 }))
      .mockResolvedValueOnce(
        response({ notification: { ...base, readAt: "2026-09-18T01:00:00.000Z" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    await waitFor(() => expect(screen.getByText(base.body)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Mark Read" }));

    await waitFor(() => expect(screen.getByText("0 unread notifications.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(`/api/notifications/${base.id}/read`, {
      method: "PATCH",
      credentials: "include",
    });
  });

  /**
   * `entityType`/`entityId` shipped on every row as "a deep-link target" and
   * were rendered by nothing, so each notification named a task it could not
   * open. These two cases pin the mapping and its refusal to guess.
   */
  it("carries the id for an entity that has a route of its own", async () => {
    const onEvent = {
      ...base,
      kind: "event_cancelled",
      body: "Semester Hackathon was cancelled.",
      entityType: "event",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ notifications: [onEvent], unreadCount: 1 })),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("link", { name: onEvent.body })).toHaveAttribute(
        "href",
        `/events/${onEvent.entityId}`,
      ),
    );
  });

  /**
   * The board has no per-task URL, so the id stays OUT of the link. A `?task=`
   * that no page reads looks like a working deep link and silently is not —
   * which is exactly the state this assertion exists to prevent returning to.
   */
  it("links to the page but not the row when the row has no route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ notifications: [base], unreadCount: 1 })),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("link", { name: base.body })).toHaveAttribute("href", "/tasks"),
    );
  });

  it("leaves a notification with no reachable entity as plain text", async () => {
    const orphan = { ...base, entityType: null, entityId: null };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ notifications: [orphan], unreadCount: 1 })),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText(orphan.body)).toBeInTheDocument());
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

function response(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
