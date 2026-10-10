import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessagesPage } from "./messages";

/** Who is signed in; a test may change the role, and it goes back to officer after. */
const me = vi.hoisted(() => ({ role: "officer" }));
const TIERS: Record<string, number> = { officer: 0, director: 1 };

vi.mock("@/hooks/use-me", () => ({
  useMe: () => ({
    status: "ok",
    user: {
      id: "018f3a4b-0000-7000-8000-000000000001",
      email: "member@example.com",
      role: me.role,
      tier: TIERS[me.role] ?? 2,
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
              createdBy: null,
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
              createdBy: null,
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

  it("shows a picked mention by name, and sends it as the member's id", async () => {
    const threadId = "018f3a4b-0000-7000-8000-000000000002";
    const other = "018f3a4b-0000-7000-8000-000000000008";
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === `/api/threads/${threadId}/messages` && init?.method === "POST") {
        const { body } = JSON.parse(String(init.body)) as { body: string };
        return response({ message: { ...buildMessage(threadId, other, body), body } }, 201);
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
              createdBy: null,
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

    // The box reads as written; the id never shows.
    await waitFor(() => expect(input).toHaveValue("hi @Jamie Lee "));
    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/threads/${threadId}/messages`,
      expect.objectContaining({ method: "POST" }),
    );

    fireEvent.change(input, {
      target: { value: "hi @Jamie Lee can you check?", selectionStart: 28 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(input).toHaveValue(""));
    const post = fetchMock.mock.calls.find(
      ([url, init]) => url === `/api/threads/${threadId}/messages` && init?.method === "POST",
    );
    expect(JSON.parse(String(post![1]!.body))).toEqual({
      body: `hi @[${other}] can you check?`,
    });
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
              createdBy: null,
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
              createdBy: null,
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
              createdBy: null,
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
    // The open conversation is marked as current, not only by its colour.
    expect(screen.getByRole("button", { name: /logistics/i })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: /winter showcase/i })).not.toHaveAttribute(
      "aria-current",
    );
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
      createdBy: null,
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
    createdBy: null,
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
    deletedAt: null,
    deletedBy: null,
  };
}

/**
 * Deleting and grouping, through the page: the controls each role is offered,
 * the confirmations, and what the page does once the server has answered.
 */
describe("MessagesPage — runs, and deleting", () => {
  const SELF = "018f3a4b-0000-7000-8000-000000000001";
  const ALEX = "018f3a4b-0000-7000-8000-000000000003";
  const GROUP_ID = "018f3a4b-0000-7000-8000-0000000000a0";
  const EVENT_THREAD = "018f3a4b-0000-7000-8000-0000000000b0";

  afterEach(() => {
    vi.unstubAllGlobals();
    me.role = "officer";
  });

  /** A response with `ok` read from the status, unlike `response` above. */
  const reply = (body: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  const roster = [
    {
      id: SELF,
      role: "officer",
      tier: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      name: "Sam Self",
      email: "sam@example.com",
      teamIds: [],
      portfolio: null,
    },
    {
      id: ALEX,
      role: "officer",
      tier: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      name: "Alex Morgan",
      email: "alex@example.com",
      teamIds: [],
      portfolio: null,
    },
  ];

  function group(name: string, createdBy: string | null) {
    return {
      ...thread(GROUP_ID, name),
      kind: "group",
      eventId: null,
      createdBy,
      memberIds: [SELF, ALEX],
      lastMessageAt: "2026-10-01T00:00:00.000Z",
    };
  }

  /** A message `minute` minutes into 18 September, with an id of its own. */
  function said(n: number, author: string, body: string, minute: number) {
    return {
      ...buildMessage(GROUP_ID, author, body),
      id: `018f3a4b-0000-7000-8000-0000000001${String(n).padStart(2, "0")}`,
      createdAt: `2026-09-18T00:${String(minute).padStart(2, "0")}:00.000Z`,
    };
  }

  function stubServer({
    threads,
    messages = () => [],
    onDelete = () => reply(null, 204),
  }: {
    threads: () => unknown[];
    messages?: (threadId: string) => unknown[] | "gone";
    onDelete?: (url: string) => ReturnType<typeof reply>;
  }) {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return onDelete(input);
      if (input === "/api/threads") return reply({ threads: threads() });
      if (input === "/api/members") return reply({ members: roster });
      const match = /^\/api\/threads\/([^/?]+)\/messages/.exec(input);
      if (match) {
        const items = messages(match[1]!);
        return items === "gone"
          ? reply({ error: { code: "THREAD_NOT_FOUND", message: "Thread not found." } }, 404)
          : reply({ messages: items, nextCursor: null });
      }
      return reply({});
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("draws one header over a run of messages from one sender", async () => {
    stubServer({
      threads: () => [group("Logistics", SELF)],
      // Newest first, as the API pages them.
      messages: () => [
        said(3, SELF, "Thanks both", 3),
        said(2, ALEX, "Doors at six", 1),
        said(1, ALEX, "Venue confirmed", 0),
      ],
    });
    renderPage(`/messages?thread=${GROUP_ID}`);

    await screen.findByText("Doors at six");
    expect(screen.getAllByRole("heading", { name: "Alex Morgan" })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { name: "Sam Self" })).toHaveLength(1);
    // Every message is still its own article, named for who sent it.
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getAllByRole("article", { name: /^Alex Morgan, / })).toHaveLength(2);
  });

  it("deletes your own message for everyone after confirming, and offers nothing on others'", async () => {
    const mine = said(2, SELF, "Wrong thread, sorry", 1);
    const theirs = said(1, ALEX, "Keep this", 0);
    const fetchMock = stubServer({
      threads: () => [group("Logistics", null)],
      messages: () => [mine, theirs],
      onDelete: () =>
        reply({
          message: { ...mine, body: "", deletedAt: "2026-09-18T01:00:00.000Z", deletedBy: SELF },
        }),
    });
    renderPage(`/messages?thread=${GROUP_ID}`);

    await screen.findByText("Wrong thread, sorry");
    expect(
      screen.queryByRole("button", { name: /^Delete message from Alex Morgan/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Delete message from Sam Self/ }));

    const dialog = await screen.findByRole("dialog", {
      name: "Delete this message for everyone?",
    });
    // Enter on a dialog that just opened must never be the thing that deletes.
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete message" }));

    expect(await screen.findByText("Message deleted")).toBeInTheDocument();
    expect(screen.queryByText("Wrong thread, sorry")).not.toBeInTheDocument();
    expect(screen.getByText("Keep this")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/threads/${GROUP_ID}/messages/${mine.id}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("keeps the message, and says why in the dialog, when the server refuses", async () => {
    const mine = said(1, SELF, "Still here", 0);
    stubServer({
      threads: () => [group("Logistics", null)],
      messages: () => [mine],
      onDelete: () =>
        reply({ error: { code: "THREAD_ARCHIVED", message: "This thread is read-only." } }, 409),
    });
    renderPage(`/messages?thread=${GROUP_ID}`);
    await screen.findByText("Still here");

    fireEvent.click(screen.getByRole("button", { name: /^Delete message from Sam Self/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete message" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("This thread is read-only.");
    expect(screen.getByText("Still here")).toBeInTheDocument();
  });

  it("lets the president delete anyone's message", async () => {
    me.role = "president";
    stubServer({
      threads: () => [group("Logistics", null)],
      messages: () => [said(1, ALEX, "Off topic", 0)],
    });
    renderPage(`/messages?thread=${GROUP_ID}`);

    expect(
      await screen.findByRole("button", { name: /^Delete message from Alex Morgan/ }),
    ).toBeInTheDocument();
  });

  it.each(["director", "officer"] as const)(
    "lets the %s who opened a group delete it, then opens the next conversation",
    async (role) => {
      me.role = role;
      let threads = [group("Logistics", SELF), thread(EVENT_THREAD, "Winter Showcase")];
      const fetchMock = stubServer({
        threads: () => threads,
        onDelete: () => {
          threads = threads.filter((item) => item.id !== GROUP_ID);
          return reply(null, 204);
        },
      });
      renderPage(`/messages?thread=${GROUP_ID}`);

      await screen.findByRole("heading", { name: "Logistics", level: 2 });
      fireEvent.click(screen.getByRole("button", { name: "Delete group" }));
      const dialog = await screen.findByRole("dialog", { name: "Delete “Logistics”?" });
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
      expect(dialog).toHaveTextContent(/for every member/);
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete group" }));

      expect(
        await screen.findByRole("heading", { name: "Winter Showcase", level: 2 }),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByTestId("location")).toHaveTextContent(`?thread=${EVENT_THREAD}`),
      );
      expect(screen.queryByRole("button", { name: "Logistics" })).not.toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/threads/${GROUP_ID}`,
        expect.objectContaining({ method: "DELETE" }),
      );
    },
  );

  it("closes a group confirmation when the active conversation or permission changes", async () => {
    me.role = "director";
    const own = group("Logistics", ALEX);
    me.role = "president";
    stubServer({ threads: () => [own, thread(EVENT_THREAD, "Winter Showcase")] });
    const view = renderPage(`/messages?thread=${GROUP_ID}`);
    fireEvent.click(await screen.findByRole("button", { name: "Delete group" }));
    fireEvent.click(screen.getByText("Winter Showcase", { selector: "button span" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Logistics" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete group" }));
    me.role = "officer";
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    view.unmount();
  });

  it("keeps the group, and its draft, when deleting it is cancelled", async () => {
    me.role = "president";
    const fetchMock = stubServer({ threads: () => [group("Logistics", null)] });
    renderPage(`/messages?thread=${GROUP_ID}`);
    const box = await screen.findByLabelText(/message logistics/i);
    fireEvent.change(box, { target: { value: "half a thought", selectionStart: 14 } });

    fireEvent.click(screen.getByRole("button", { name: "Delete group" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText(/message logistics/i)).toHaveValue("half a thought");
    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/threads/${GROUP_ID}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("offers no group deletion to an officer or director who did not open it", async () => {
    stubServer({ threads: () => [group("Logistics", ALEX)] });
    const officer = renderPage(`/messages?thread=${GROUP_ID}`);
    await screen.findByRole("heading", { name: "Logistics", level: 2 });
    expect(screen.queryByRole("button", { name: "Delete group" })).not.toBeInTheDocument();
    officer.unmount();

    me.role = "director";
    stubServer({ threads: () => [group("Logistics", ALEX)] });
    renderPage(`/messages?thread=${GROUP_ID}`);
    await screen.findByRole("heading", { name: "Logistics", level: 2 });
    expect(screen.queryByRole("button", { name: "Delete group" })).not.toBeInTheDocument();
  });

  it("shows the empty state, and drops the conversation from the URL, when the last one goes", async () => {
    me.role = "president";
    let threads: unknown[] = [group("Logistics", null)];
    stubServer({
      threads: () => threads,
      onDelete: () => {
        threads = [];
        return reply(null, 204);
      },
    });
    renderPage(`/messages?thread=${GROUP_ID}`);

    fireEvent.click(await screen.findByRole("button", { name: "Delete group" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete group" }),
    );

    expect(await screen.findByText("No conversations are available yet.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^$/));
  });

  it("moves on from a conversation deleted elsewhere at the next refresh", async () => {
    let gone = false;
    stubServer({
      threads: () =>
        gone
          ? [thread(EVENT_THREAD, "Winter Showcase")]
          : [group("Logistics", ALEX), thread(EVENT_THREAD, "Winter Showcase")],
      messages: (threadId) =>
        threadId === GROUP_ID && gone ? "gone" : [said(1, ALEX, "Before it went", 0)],
    });
    renderPage(`/messages?thread=${GROUP_ID}`);
    await screen.findByText("Before it went");

    gone = true;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(
      await screen.findByRole("heading", { name: "Winter Showcase", level: 2 }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(`?thread=${EVENT_THREAD}`),
    );
  });
});

describe("MessagesPage — private membership", () => {
  const self = "018f3a4b-0000-7000-8000-000000000001";
  const other = "018f3a4b-0000-7000-8000-000000000002";
  const outside = "018f3a4b-0000-7000-8000-000000000003";
  const privateId = "018f3a4b-0000-7000-8000-000000000004";
  const roster = [
    { id: self, name: "Sam Self", email: "sam@example.com" },
    { id: other, name: "Jamie Lee", email: "jamie@example.com" },
    { id: outside, name: "Outside Member", email: "outsider@example.com" },
  ].map((member) => ({
    ...member,
    role: "officer",
    tier: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    teamIds: [],
    portfolio: null,
  }));
  afterEach(() => vi.unstubAllGlobals());

  function stub(kind: "group" | "dm") {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/members") return response({ members: roster });
        if (url === "/api/threads")
          return response({
            threads: [
              {
                ...thread(privateId, "Private chat"),
                kind,
                eventId: null,
                createdBy: self,
                memberIds: [self, other],
              },
              thread("018f3a4b-0000-7000-8000-000000000005", "Public event"),
            ],
          });
        return response({
          messages: [buildMessage(privateId, outside, "Older message")],
          nextCursor: null,
        });
      }),
    );
  }

  it.each(["group", "dm"] as const)(
    "offers only the other participant in a %s, preserving historical author names",
    async (kind) => {
      stub(kind);
      renderPage("/messages?thread=" + privateId);
      const box = await screen.findByLabelText("Message Private chat");
      expect(
        await screen.findByRole("heading", { name: "Outside Member", level: 3 }),
      ).toBeInTheDocument();
      fireEvent.change(box, { target: { value: "@", selectionStart: 1 } });
      expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
        "Jamie Lee",
      ]);
      fireEvent.change(box, { target: { value: "@outsider@example.com", selectionStart: 21 } });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    },
  );

  it("shows the actual group members and closes the dialog on a conversation switch", async () => {
    stub("group");
    renderPage("/messages?thread=" + privateId);
    const trigger = await screen.findByRole("button", { name: "Members (2)" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Group members" });
    expect(within(dialog).getByText("Sam Self")).toBeInTheDocument();
    expect(within(dialog).getByText("sam@example.com")).toBeInTheDocument();
    expect(within(dialog).getByText("Jamie Lee")).toBeInTheDocument();
    expect(within(dialog).getByText("You")).toBeInTheDocument();
    expect(within(dialog).getByText("Group creator")).toBeInTheDocument();
    expect(within(dialog).queryByText("Outside Member")).not.toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText("Public event", { selector: "button span" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Members/ })).not.toBeInTheDocument();
  });
});
