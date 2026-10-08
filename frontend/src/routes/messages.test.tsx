import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
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

    renderPage();

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

    renderPage();

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

    renderPage();
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

    renderPage();
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

    renderPage();
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

  it("sends on Enter, and not a second copy while the first is in flight", async () => {
    const threadId = "018f3a4b-0000-7000-8000-000000000002";
    const author = "018f3a4b-0000-7000-8000-000000000003";
    let land: (value: unknown) => void = () => undefined;
    const pendingSend = new Promise((resolve) => {
      land = resolve;
    });
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/threads")
        return response({ threads: [thread(threadId, "Winter Showcase")] });
      if (input === "/api/members") return response({ members: [] });
      if (init?.method === "POST") return pendingSend;
      return response({ messages: [], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length;

    renderPage();
    const box = await screen.findByLabelText(/message winter showcase/i);
    fireEvent.change(box, { target: { value: "Ready for doors." } });
    fireEvent.keyDown(box, { key: "Enter" });
    await screen.findByRole("button", { name: "Sending…" });
    // The Send button is disabled by now, but Enter does not go through it.
    fireEvent.keyDown(box, { key: "Enter" });
    expect(posts()).toBe(1);

    await act(async () => {
      land(response({ message: buildMessage(threadId, author, "Ready for doors.") }, 201));
    });
    expect(await screen.findByText("Ready for doors.")).toBeInTheDocument();
    expect(box).toHaveValue("");
  });

  it("links an event's thread to that event's Thread tab, and a group to nothing", async () => {
    const eventThread = thread("018f3a4b-0000-7000-8000-0000000000a1", "Winter Showcase");
    const groupThread = {
      ...thread("018f3a4b-0000-7000-8000-0000000000b2", "Logistics"),
      kind: "group",
      eventId: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input === "/api/threads") return response({ threads: [eventThread, groupThread] });
        if (input === "/api/members") return response({ members: [] });
        return response({ messages: [], nextCursor: null });
      }),
    );

    renderPage();

    expect(await screen.findByRole("link", { name: "View event" })).toHaveAttribute(
      "href",
      `/events/${eventThread.eventId}?tab=thread`,
    );
    fireEvent.click(screen.getByRole("button", { name: /logistics/i }));
    await screen.findByRole("heading", { name: "Logistics" });
    expect(screen.queryByRole("link", { name: "View event" })).not.toBeInTheDocument();
  });

  describe("the conversation in the URL", () => {
    const threadA = "018f3a4b-0000-7000-8000-0000000000a1";
    const threadB = "018f3a4b-0000-7000-8000-0000000000b2";

    function stubTwoThreads() {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string) => {
          if (input === "/api/threads") {
            return response({
              threads: [thread(threadA, "Winter Showcase"), thread(threadB, "Logistics")],
            });
          }
          if (input === "/api/members") return response({ members: [] });
          return response({ messages: [], nextCursor: null });
        }),
      );
    }

    it("opens the conversation a link names, not the most recent one", async () => {
      stubTwoThreads();

      renderPage(`/messages?thread=${threadB}`);

      expect(await screen.findByRole("heading", { name: "Logistics" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Winter Showcase" })).not.toBeInTheDocument();
    });

    it("falls back to the most recent conversation when the named one is not listed", async () => {
      stubTwoThreads();

      renderPage("/messages?thread=018f3a4b-0000-7000-8000-0000000000ff");

      expect(await screen.findByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument();
    });

    it("writes the conversation the reader picks back to the URL", async () => {
      stubTwoThreads();

      renderPage();
      await screen.findByRole("heading", { name: "Winter Showcase" });
      fireEvent.click(screen.getByRole("button", { name: /logistics/i }));

      expect(await screen.findByRole("heading", { name: "Logistics" })).toBeInTheDocument();
      expect(screen.getByTestId("location")).toHaveTextContent(`?thread=${threadB}`);
    });
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

    renderPage();
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

  describe("when a refresh reorders the list", () => {
    const threadA = "018f3a4b-0000-7000-8000-0000000000a1";
    const threadB = "018f3a4b-0000-7000-8000-0000000000b2";
    const winter = thread(threadA, "Winter Showcase");
    // Logistics has had a message since, so the next read puts it first.
    const busier = { ...thread(threadB, "Logistics"), lastMessageAt: "2026-10-01T00:00:00.000Z" };
    let list: unknown[] = [];

    function stubThreads() {
      list = [winter, thread(threadB, "Logistics")];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string) => {
          if (input === "/api/threads") return response({ threads: list });
          if (input === "/api/members") return response({ members: [] });
          return response({ messages: [], nextCursor: null });
        }),
      );
    }

    const listedFirst = () =>
      within(screen.getByRole("navigation", { name: "Conversations" })).getAllByRole("button")[0];

    it("keeps the conversation on screen, with its draft and search, on a focus refresh", async () => {
      stubThreads();
      renderPage();
      fireEvent.change(await screen.findByLabelText(/message winter showcase/i), {
        target: { value: "Half a thought" },
      });
      fireEvent.change(screen.getByLabelText(/search this conversation/i), {
        target: { value: "venue" },
      });

      list = [busier, winter];
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await waitFor(() => expect(listedFirst()).toHaveTextContent("Logistics"));

      expect(screen.getByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument();
      expect(screen.getByLabelText(/message winter showcase/i)).toHaveValue("Half a thought");
      expect(screen.getByLabelText(/search this conversation/i)).toHaveValue("venue");
    });

    it("keeps it across a timed poll, and moves only on a pick or when it is gone", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        stubThreads();
        renderPage();
        fireEvent.change(await screen.findByLabelText(/message winter showcase/i), {
          target: { value: "Half a thought" },
        });

        list = [busier, winter];
        await act(async () => {
          await vi.advanceTimersByTimeAsync(15_000);
        });
        await waitFor(() => expect(listedFirst()).toHaveTextContent("Logistics"));
        expect(screen.getByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument();
        expect(screen.getByLabelText(/message winter showcase/i)).toHaveValue("Half a thought");

        // Picking another conversation still moves, as it always has…
        fireEvent.click(listedFirst()!);
        expect(await screen.findByRole("heading", { name: "Logistics" })).toBeInTheDocument();

        // …and one that disappears hands over to what is left.
        list = [winter];
        await act(async () => {
          await vi.advanceTimersByTimeAsync(15_000);
        });
        expect(await screen.findByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("starting a conversation while a list read is in flight", () => {
    const self = "018f3a4b-0000-7000-8000-000000000001";
    const other = "018f3a4b-0000-7000-8000-000000000008";
    const winter = thread("018f3a4b-0000-7000-8000-0000000000a1", "Winter Showcase");
    const dm = {
      ...thread("018f3a4b-0000-7000-8000-0000000000d4", "unused"),
      kind: "dm",
      name: null,
      eventId: null,
      memberIds: [self, other],
    };
    const jamie = {
      id: other,
      role: "officer",
      tier: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      name: "Jamie Lee",
      email: "jamie@example.com",
      teamIds: [],
      portfolio: null,
    };

    /**
     * The first list read answers at once; the second (a refresh) is held until
     * the test lets it land; every later one is the fresh read the start asks for.
     */
    function stub({
      initial,
      created,
      fresh,
    }: {
      initial: unknown[];
      created: { thread: unknown; status: number };
      fresh: "listed" | "fails";
    }) {
      let held: (value: unknown) => void = () => undefined;
      const stale = new Promise((resolve) => {
        held = resolve;
      });
      const reads: string[] = [];
      let listReads = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string, init?: RequestInit) => {
          if (input === "/api/threads" && init?.method === "POST") {
            return response({ thread: created.thread }, created.status);
          }
          if (input === "/api/threads") {
            listReads += 1;
            if (listReads === 1) return response({ threads: initial });
            if (listReads === 2) return stale;
            return fresh === "listed"
              ? response({ threads: [dm, winter] })
              : { ok: false, status: 500, json: async () => ({}) };
          }
          if (input.endsWith("/read")) {
            reads.push(input);
            return response({ thread: winter });
          }
          if (input === "/api/members") return response({ members: [jamie] });
          return response({ messages: [], nextCursor: null });
        }),
      );
      return {
        land: (threads: unknown[]) => held(response({ threads })),
        reads,
        listReads: () => listReads,
      };
    }

    const listed = () =>
      within(screen.getByRole("navigation", { name: "Conversations" }))
        .getAllByRole("button")
        .map((button) => button.textContent);

    async function startWithJamieDuringARefresh(api: ReturnType<typeof stub>) {
      renderPage();
      await screen.findByRole("heading", { name: "Winter Showcase" });
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await waitFor(() => expect(api.listReads()).toBe(2));
      fireEvent.click(screen.getByRole("button", { name: /new message/i }));
      fireEvent.click(within(await screen.findByRole("dialog")).getByText("Jamie Lee"));
      expect(await screen.findByRole("heading", { name: "Jamie Lee" })).toBeInTheDocument();
    }

    it("keeps the new conversation, its draft and its search when the older read lands", async () => {
      const api = stub({
        initial: [winter],
        created: { thread: dm, status: 201 },
        fresh: "listed",
      });
      await startWithJamieDuringARefresh(api);
      fireEvent.change(screen.getByLabelText(/message jamie lee/i), {
        target: { value: "Hello Jamie" },
      });
      fireEvent.change(screen.getByLabelText(/search this conversation/i), {
        target: { value: "plans" },
      });

      // The read that began before the start: no dm in it, and Winter unread.
      await act(async () => {
        api.land([{ ...winter, unreadCount: 3 }]);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(screen.getByRole("heading", { name: "Jamie Lee" })).toBeInTheDocument();
      expect(screen.getByLabelText(/message jamie lee/i)).toHaveValue("Hello Jamie");
      expect(screen.getByLabelText(/search this conversation/i)).toHaveValue("plans");
      expect(api.reads.filter((url) => url.includes(winter.id))).toEqual([]);
      // The fresh read lists the dm once, beside Winter.
      expect(listed()).toEqual(["Jamie Lee", "Winter Showcase"]);
    });

    it("keeps the new conversation when the fresh read fails", async () => {
      const api = stub({ initial: [winter], created: { thread: dm, status: 201 }, fresh: "fails" });
      await startWithJamieDuringARefresh(api);

      await act(async () => {
        api.land([winter]);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(screen.getByRole("heading", { name: "Jamie Lee" })).toBeInTheDocument();
      expect(listed()).toEqual(["Jamie Lee", "Winter Showcase"]);
    });

    it("opens a dm that already exists without listing it twice", async () => {
      const api = stub({
        initial: [winter, dm],
        created: { thread: dm, status: 200 },
        fresh: "listed",
      });
      await startWithJamieDuringARefresh(api);

      await act(async () => {
        api.land([winter, dm]);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(screen.getByRole("heading", { name: "Jamie Lee" })).toBeInTheDocument();
      expect([...listed()].sort()).toEqual(["Jamie Lee", "Winter Showcase"]);
    });
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

    renderPage();
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

/** The page links out to events, so it renders inside a router, as the app does. */
function renderPage(path = "/messages") {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <MessagesPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** Shows the router's search string, so a test can read what the page wrote to the URL. */
function LocationProbe() {
  return <output data-testid="location">{useLocation().search}</output>;
}

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
