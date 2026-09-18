import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationsPage } from "./notifications";

describe("NotificationsPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows unread notifications and marks one as read", async () => {
    const notification = {
      id: "018f3a4b-0000-7000-8000-000000000001",
      userId: "018f3a4b-0000-7000-8000-000000000002",
      kind: "task_assigned",
      body: "You were assigned Confirm venue access.",
      entityType: "task",
      entityId: "018f3a4b-0000-7000-8000-000000000003",
      readAt: null,
      createdAt: "2026-09-18T00:00:00.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ notifications: [notification], unreadCount: 1 }))
      .mockResolvedValueOnce(
        response({ notification: { ...notification, readAt: "2026-09-18T01:00:00.000Z" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationsPage />);

    await waitFor(() => expect(screen.getByText(notification.body)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Mark Read" }));

    await waitFor(() => expect(screen.getByText("0 unread notifications.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(`/api/notifications/${notification.id}/read`, {
      method: "PATCH",
      credentials: "include",
    });
  });
});

function response(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
