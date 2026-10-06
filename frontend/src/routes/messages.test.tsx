import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("renders a mention token as the mentioned member's name", async () => {
    const threadId = "018f3a4b-0000-7000-8000-000000000002";
    const authorId = "018f3a4b-0000-7000-8000-000000000003";
    const mentioned = "018f3a4b-0000-7000-8000-000000000007";
    const message = buildMessage(threadId, authorId, `hey @[${mentioned}] check this`);
    const fetchMock = vi.fn(async (input: string) => {
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
              id: mentioned,
              role: "officer",
              tier: 0,
              createdAt: "2026-01-01T00:00:00.000Z",
              name: "Jamie Lee",
              email: "jamie@example.com",
              teamIds: [],
              portfolio: null,
            },
          ],
        });
      }
      return response({ messages: [message], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MessagesPage />);

    await waitFor(() => expect(screen.getByText("@Jamie Lee")).toBeInTheDocument());
    expect(screen.queryByText(`@[${mentioned}]`)).not.toBeInTheDocument();
  });

  it("opens the mention picker on @ and inserts the token on pick", async () => {
    const threadId = "018f3a4b-0000-7000-8000-000000000002";
    const other = "018f3a4b-0000-7000-8000-000000000008";
    const fetchMock = vi.fn(async (input: string) => {
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
              id: other,
              role: "officer",
              tier: 0,
              createdAt: "2026-01-01T00:00:00.000Z",
              name: "Jamie Lee",
              email: "jamie@example.com",
              teamIds: [],
              portfolio: null,
            },
          ],
        });
      }
      return response({ messages: [], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MessagesPage />);
    const input = await screen.findByLabelText(/message winter showcase/i);

    fireEvent.change(input, { target: { value: "hi @Jam", selectionStart: 7 } });
    const option = await screen.findByRole("option", { name: "Jamie Lee" });
    fireEvent.click(option);

    await waitFor(() => expect(input).toHaveValue(`hi @[${other}] `));
  });

  it("starts a dm from the new conversation dialog", async () => {
    const threadId = "018f3a4b-0000-7000-8000-000000000002";
    const other = "018f3a4b-0000-7000-8000-000000000008";
    const newThreadId = "018f3a4b-0000-7000-8000-000000000009";
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/threads" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ kind: "dm", memberId: other });
        return response(
          {
            thread: {
              id: newThreadId,
              kind: "dm",
              name: null,
              teamId: null,
              eventId: null,
              minTier: 0,
              createdAt: "2026-09-18T00:00:00.000Z",
              memberIds: ["018f3a4b-0000-7000-8000-000000000001", other],
              lastReadAt: null,
              unreadCount: 0,
              lastMessageAt: null,
            },
          },
          201,
        );
      }
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
              id: other,
              role: "officer",
              tier: 0,
              createdAt: "2026-01-01T00:00:00.000Z",
              name: "Jamie Lee",
              email: "jamie@example.com",
              teamIds: [],
              portfolio: null,
            },
          ],
        });
      }
      return response({ messages: [], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MessagesPage />);
    await screen.findByRole("heading", { name: "Winter Showcase" });

    fireEvent.click(screen.getByRole("button", { name: /new message/i }));
    fireEvent.click(await screen.findByText("Jamie Lee"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/threads",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    // The new dm is now the active thread — its name resolves to the other party.
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Jamie Lee" })).toBeInTheDocument(),
    );
  });

  it("searches the active thread's messages after a debounce", async () => {
    const threadId = "018f3a4b-0000-7000-8000-000000000002";
    const fetchMock = vi.fn(async (input: string) => {
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
      if (input === "/api/members") return response({ members: [] });
      return response({ messages: [], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MessagesPage />);
    await screen.findByRole("heading", { name: "Winter Showcase" });

    fireEvent.change(screen.getByLabelText(/search this conversation/i), {
      target: { value: "venue" },
    });

    await waitFor(
      () =>
        expect(fetchMock).toHaveBeenCalledWith(
          `/api/threads/${threadId}/messages?q=venue`,
          expect.anything(),
        ),
      { timeout: 1000 },
    );
  });

  it("keeps a draft typed in another thread when an earlier send lands", async () => {
    const threadA = "018f3a4b-0000-7000-8000-0000000000a1";
    const threadB = "018f3a4b-0000-7000-8000-0000000000b2";
    const author = "018f3a4b-0000-7000-8000-000000000003";
    let land: (value: unknown) => void = () => undefined;
    const pendingSend = new Promise((resolve) => {
      land = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input === "/api/threads") {
          return response({
            threads: [thread(threadA, "Winter Showcase"), thread(threadB, "Logistics")],
          });
        }
        if (input === "/api/members") return response({ members: [] });
        if (init?.method === "POST") return pendingSend;
        return response({ messages: [], nextCursor: null });
      }),
    );

    render(<MessagesPage />);
    const first = await screen.findByLabelText(/message winter showcase/i);
    fireEvent.change(first, { target: { value: "Doors at six" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    fireEvent.click(screen.getByRole("button", { name: /logistics/i }));
    const second = await screen.findByLabelText(/message logistics/i);
    fireEvent.change(second, { target: { value: "Half-typed for B" } });
    // A's send is not B's: B can send while it is still in flight.
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();

    await act(async () => {
      land(response({ message: buildMessage(threadA, author, "Doors at six") }, 201));
      // Let the send, and the page's handling of its answer, run to the end.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByLabelText(/message logistics/i)).toHaveValue("Half-typed for B");
    expect(screen.queryByText("Doors at six")).not.toBeInTheDocument();
  });

  it("forgets a failed start when the dialog is closed and reopened", async () => {
    const other = "018f3a4b-0000-7000-8000-000000000008";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input === "/api/threads" && init?.method === "POST") {
          return { ok: false, status: 500, json: async () => ({}) };
        }
        if (input === "/api/threads") {
          return response({
            threads: [thread("018f3a4b-0000-7000-8000-000000000002", "Winter Showcase")],
          });
        }
        if (input === "/api/members") {
          return response({
            members: [
              {
                id: other,
                role: "officer",
                tier: 0,
                createdAt: "2026-01-01T00:00:00.000Z",
                name: "Jamie Lee",
                email: "jamie@example.com",
                teamIds: [],
                portfolio: null,
              },
            ],
          });
        }
        return response({ messages: [], nextCursor: null });
      }),
    );

    render(<MessagesPage />);
    await screen.findByRole("heading", { name: "Winter Showcase" });
    fireEvent.click(screen.getByRole("button", { name: /new message/i }));
    fireEvent.click(await screen.findByText("Jamie Lee"));
    expect(await screen.findByText(/failed to start the conversation/i)).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new message/i }));

    await screen.findByRole("dialog");
    expect(screen.queryByText(/failed to start the conversation/i)).not.toBeInTheDocument();
  });
});

function thread(id: string, name: string) {
  return {
    id,
    kind: "event",
    name,
    teamId: null,
    eventId: "018f3a4b-0000-7000-8000-000000000004",
    minTier: 0,
    createdAt: "2026-06-01T00:00:00.000Z",
    memberIds: [],
    lastReadAt: null,
    unreadCount: 0,
    lastMessageAt: "2026-09-18T00:00:00.000Z",
  };
}

function response(body: unknown, status = 200) {
  return { ok: true, status, json: async () => body };
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
