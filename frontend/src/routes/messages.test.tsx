import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessagesPage } from "./messages";

vi.mock("@/hooks/use-me", () => ({
  useMe: () => ({
    status: "ok",
    user: {
      id: "018f3a4b-0000-7000-8000-000000000001",
      email: "member@example.com",
      role: "officer",
      tier: 0,
    },
  }),
}));

describe("MessagesPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads a thread and sends a message", async () => {
    const threadId = "018f3a4b-0000-7000-8000-000000000002";
    const authorId = "018f3a4b-0000-7000-8000-000000000003";
    const message = buildMessage(threadId, authorId, "Venue access is confirmed.");
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/threads") {
        return response({
          threads: [
            {
              id: threadId,
              kind: "event",
              name: "Winter Showcase",
              teamId: null,
              eventId: "018f3a4b-0000-7000-8000-000000000004",
              minTier: 0,
              createdAt: "2026-06-01T00:00:00.000Z",
              memberIds: [],
              lastReadAt: null,
              unreadCount: 0,
              lastMessageAt: "2026-09-18T00:00:00.000Z",
            },
          ],
        });
      }
      if (input === "/api/members") {
        return response({
          members: [
            {
              id: authorId,
              role: "officer",
              tier: 0,
              createdAt: "2026-01-01T00:00:00.000Z",
              name: "Alex Morgan",
              email: "alex@example.com",
              teamIds: [],
              portfolio: null,
            },
          ],
        });
      }
      if (input === `/api/threads/${threadId}/messages` && init?.method === "POST") {
        return response({ message: buildMessage(threadId, authorId, "Ready for doors.") });
      }
      return response({ messages: [message], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MessagesPage />);

    await waitFor(() => expect(screen.getByText(message.body)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/message winter showcase/i), {
      target: { value: "Ready for doors." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("Ready for doors.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/threads/${threadId}/messages`,
      expect.objectContaining({ method: "POST" }),
    );
  });
});

function response(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function buildMessage(channelId: string, author: string, body: string) {
  return {
    id:
      body === "Ready for doors."
        ? "018f3a4b-0000-7000-8000-000000000006"
        : "018f3a4b-0000-7000-8000-000000000005",
    channelId,
    taskId: null,
    parentId: null,
    author,
    body,
    fileKey: null,
    fileName: null,
    fileSizeBytes: null,
    fileMime: null,
    aiRunId: null,
    createdAt: "2026-09-18T00:00:00.000Z",
    editedAt: null,
  };
}
