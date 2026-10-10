import type { Thread } from "@ctp/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useThreadMessages, useThreads } from "./use-threads";

const THREAD_A = "018f3a4b-0000-7000-8000-0000000000a1";
const THREAD_B = "018f3a4b-0000-7000-8000-0000000000b2";
const AUTHOR = "018f3a4b-0000-7000-8000-0000000000c3";

afterEach(() => vi.unstubAllGlobals());

let sequence = 0;
/** A message as the API sends it; ids and times rise with each call. */
function message(channelId: string, body: string) {
  sequence += 1;
  return {
    id: `018f3a4b-0000-7000-8000-${String(sequence).padStart(12, "0")}`,
    channelId,
    taskId: null,
    parentId: null,
    author: AUTHOR,
    body,
    fileKey: null,
    fileName: null,
    fileSizeBytes: null,
    fileMime: null,
    aiRunId: null,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, sequence)).toISOString(),
    editedAt: null,
    // Typed wide, so a test can turn one into its tombstone.
    deletedAt: null as string | null,
    deletedBy: null as string | null,
  };
}

const respond = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

type Answer = ReturnType<typeof respond>;

/**
 * Routes each request to `answer`, which sees the URL and method. Anything it
 * returns undefined for is an empty page, so a test only states what matters.
 */
function stubFetch(answer: (url: string, method: string) => Answer | Promise<Answer> | undefined) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    return Promise.resolve(answer(url, method) ?? respond({ messages: [], nextCursor: null }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const bodies = (state: ReturnType<typeof useThreadMessages>["state"]) =>
  state.status === "ok" ? state.items.map((item) => item.body) : [];

it("keeps a send that lands after a switch out of the thread now on screen", async () => {
  const post = deferred<Answer>();
  const sent = message(THREAD_A, "For A");
  stubFetch((url, method) => (method === "POST" ? post.promise : undefined));
  const hook = renderHook(({ id }) => useThreadMessages(id), { initialProps: { id: THREAD_A } });
  await waitFor(() => expect(hook.result.current.state.status).toBe("ok"));

  let result: Promise<unknown> = Promise.resolve();
  act(() => {
    result = hook.result.current.send("For A");
  });
  expect(hook.result.current.sending).toBe(true);

  hook.rerender({ id: THREAD_B });
  await waitFor(() => expect(hook.result.current.state.status).toBe("ok"));
  // A's send is still in flight, but it is not this thread's.
  expect(hook.result.current.sending).toBe(false);

  await act(async () => {
    post.resolve(respond({ message: sent }, 201));
    await result;
  });

  expect(bodies(hook.result.current.state)).toEqual([]);
  // No message back means the caller must not clear the draft now in the box.
  await expect(result).resolves.toBeUndefined();
});

it("drops a late failure from a thread the reader has left", async () => {
  const post = deferred<Answer>();
  stubFetch((url, method) => (method === "POST" ? post.promise : undefined));
  const hook = renderHook(({ id }) => useThreadMessages(id), { initialProps: { id: THREAD_A } });
  await waitFor(() => expect(hook.result.current.state.status).toBe("ok"));

  let result: Promise<unknown> = Promise.resolve();
  act(() => {
    result = hook.result.current.send("Lost");
  });
  hook.rerender({ id: THREAD_B });
  await waitFor(() => expect(hook.result.current.state.status).toBe("ok"));

  await act(async () => {
    post.resolve(respond({ error: { code: "X", message: "no" } }, 500));
    await result;
  });

  expect(hook.result.current.sendError).toBeUndefined();
});

it("does not hand back a send from before the reader left and came back", async () => {
  const post = deferred<Answer>();
  const sent = message(THREAD_A, "Back again");
  stubFetch((url, method) => (method === "POST" ? post.promise : undefined));
  const hook = renderHook(({ id }) => useThreadMessages(id), { initialProps: { id: THREAD_A } });
  await waitFor(() => expect(hook.result.current.state.status).toBe("ok"));

  let result: Promise<unknown> = Promise.resolve();
  act(() => {
    result = hook.result.current.send("Back again");
  });
  hook.rerender({ id: THREAD_B });
  hook.rerender({ id: THREAD_A });
  await waitFor(() => expect(hook.result.current.state.status).toBe("ok"));

  await act(async () => {
    post.resolve(respond({ message: sent }, 201));
    await result;
  });

  // The message is A's, and A is on screen, so it shows…
  expect(bodies(hook.result.current.state)).toEqual(["Back again"]);
  // …but the draft in the box was typed on this visit, so it must stay.
  await expect(result).resolves.toBeUndefined();
});

it("keeps a sent message out of a search it does not match", async () => {
  stubFetch((url, method) =>
    method === "POST" ? respond({ message: message(THREAD_A, "hello") }, 201) : undefined,
  );
  const hook = renderHook(() => useThreadMessages(THREAD_A, "venue"));
  await waitFor(() => expect(hook.result.current.state.status).toBe("ok"));

  await act(async () => {
    await hook.result.current.send("hello");
  });

  expect(bodies(hook.result.current.state)).toEqual([]);
});

it("loads older pages with the cursor and keeps them through a refresh", async () => {
  // Written in the order they were sent: times rise with each one.
  const older = message(THREAD_A, "older");
  const newest = message(THREAD_A, "newest");
  const arrived = message(THREAD_A, "arrived");
  let refreshed = false;
  const fetchMock = stubFetch((url) => {
    if (url.includes("before=")) return respond({ messages: [older], nextCursor: null });
    if (url === `/api/threads/${THREAD_A}/messages`) {
      return respond({
        messages: refreshed ? [arrived, newest] : [newest],
        nextCursor: newest.id,
      });
    }
    return undefined;
  });
  const hook = renderHook(() => useThreadMessages(THREAD_A));
  await waitFor(() => expect(bodies(hook.result.current.state)).toEqual(["newest"]));

  await act(async () => {
    await hook.result.current.loadOlder();
  });
  expect(fetchMock).toHaveBeenCalledWith(
    `/api/threads/${THREAD_A}/messages?before=${newest.id}`,
    expect.anything(),
  );
  expect(bodies(hook.result.current.state)).toEqual(["newest", "older"]);
  const state = hook.result.current.state;
  expect(state.status === "ok" && state.nextCursor).toBeNull();

  // Coming back to the tab re-reads the newest page.
  refreshed = true;
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });

  await waitFor(() =>
    expect(bodies(hook.result.current.state)).toEqual(["arrived", "newest", "older"]),
  );
});

type Fixture = ReturnType<typeof message>;

/** `count` messages in `channelId`, oldest first, as they were sent. */
const history = (channelId: string, from: number, count: number): Fixture[] =>
  Array.from({ length: count }, (_, index) => message(channelId, `m${from + index}`));

/** Answers a GET the way the route pages: newest first, 50 at a time, `before` a message id. */
function paged(all: readonly Fixture[], url: string): Answer {
  const before = new URL(url, "http://localhost").searchParams.get("before");
  const newestFirst = [...all].reverse();
  const from = before ? newestFirst.findIndex((item) => item.id === before) + 1 : 0;
  const page = newestFirst.slice(from, from + 50);
  return respond({
    messages: page,
    nextCursor: from + 50 < newestFirst.length ? page.at(-1)!.id : null,
  });
}

const cursorOf = (state: ReturnType<typeof useThreadMessages>["state"]) =>
  state.status === "ok" ? state.nextCursor : "not loaded";

const returnToTab = () =>
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });

/** Lets every pending response, and what the hook does with it, run out. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe("catching up after time away", () => {
  it("closes a gap of more than a page, within the search being shown", async () => {
    let all = history(THREAD_A, 0, 1);
    const fetchMock = stubFetch((url) => paged(all, url));
    const hook = renderHook(() => useThreadMessages(THREAD_A, "m"));
    await waitFor(() => expect(bodies(hook.result.current.state)).toEqual(["m0"]));

    // Sixty arrive while the tab is away — more than one page.
    all = [...all, ...history(THREAD_A, 1, 60)];
    returnToTab();

    await waitFor(() => expect(bodies(hook.result.current.state)).toHaveLength(61));
    expect(new Set(bodies(hook.result.current.state)).size).toBe(61);
    expect(cursorOf(hook.result.current.state)).toBeNull();
    // Every page of the catch-up kept the search.
    expect(fetchMock.mock.calls.every(([input]) => String(input).includes("q=m"))).toBe(true);
  });

  it("keeps older pages already loaded, and the cursor below them", async () => {
    let all = history(THREAD_A, 1, 100);
    stubFetch((url) => paged(all, url));
    const hook = renderHook(() => useThreadMessages(THREAD_A));
    await waitFor(() => expect(bodies(hook.result.current.state)).toHaveLength(50));
    const heldCursor = cursorOf(hook.result.current.state);

    all = [...all, ...history(THREAD_A, 101, 70)];
    returnToTab();

    await waitFor(() => expect(bodies(hook.result.current.state)).toHaveLength(120));
    expect(cursorOf(hook.result.current.state)).toBe(heldCursor);
    await act(async () => {
      await hook.result.current.loadOlder();
    });
    expect(new Set(bodies(hook.result.current.state)).size).toBe(170);
  });

  it("leaves a cursor to the page that failed, rather than a hole", async () => {
    let all = history(THREAD_A, 0, 1);
    let failNextOlder = false;
    stubFetch((url) => {
      if (failNextOlder && url.includes("before=")) {
        failNextOlder = false;
        return respond({}, 500);
      }
      return paged(all, url);
    });
    const hook = renderHook(() => useThreadMessages(THREAD_A));
    await waitFor(() => expect(bodies(hook.result.current.state)).toEqual(["m0"]));

    all = [...all, ...history(THREAD_A, 1, 60)];
    failNextOlder = true;
    returnToTab();

    // Only the newest stretch, with a way down to the rest: never two
    // stretches with the ten messages between them missing.
    await waitFor(() => expect(bodies(hook.result.current.state)).toHaveLength(50));
    expect(bodies(hook.result.current.state)).not.toContain("m0");
    expect(cursorOf(hook.result.current.state)).not.toBeNull();

    await act(async () => {
      await hook.result.current.loadOlder();
    });
    expect(new Set(bodies(hook.result.current.state)).size).toBe(61);
  });

  it("drops a catch-up that lands after the reader switched threads", async () => {
    let all = history(THREAD_A, 0, 1);
    const gap = deferred<Answer>();
    stubFetch((url) => {
      if (url.includes(THREAD_A) && url.includes("before=")) return gap.promise;
      return url.includes(THREAD_A) ? paged(all, url) : undefined;
    });
    const hook = renderHook(({ id }) => useThreadMessages(id), { initialProps: { id: THREAD_A } });
    await waitFor(() => expect(bodies(hook.result.current.state)).toEqual(["m0"]));

    all = [...all, ...history(THREAD_A, 1, 60)];
    returnToTab();
    hook.rerender({ id: THREAD_B });
    await waitFor(() => expect(hook.result.current.state.status).toBe("ok"));

    gap.resolve(paged(all, `/x?before=${all.at(-50)!.id}`));
    await settle();

    expect(bodies(hook.result.current.state)).toEqual([]);
  });
});

describe("a send that lands while a catch-up is pending", () => {
  /**
   * One message on screen, then `arrivals` more on the server. The catch-up's
   * first older page (the one that would close the gap) waits for the test; a
   * POST appends the sent message to the server's thread, as the route does.
   */
  function staged(arrivals: number) {
    let all = history(THREAD_A, 0, 1);
    const held = deferred<Answer>();
    let holding = false;
    let heldUrl = "";
    stubFetch((url, method) => {
      if (method === "POST") {
        const sent = message(THREAD_A, "m-sent");
        all = [...all, sent];
        return respond({ message: sent }, 201);
      }
      if (!url.includes(THREAD_A)) return undefined;
      if (holding && url.includes("before=")) {
        holding = false;
        heldUrl = url;
        return held.promise;
      }
      return paged(all, url);
    });
    return {
      arrive: () => {
        all = [...all, ...history(THREAD_A, 1, arrivals)];
        holding = true;
      },
      held,
      /** What the held page holds now, after the send reached the server. */
      heldPageNow: () => paged(all, heldUrl),
      all: () => all,
    };
  }

  async function catchUpThenSend(stage: ReturnType<typeof staged>) {
    const hook = renderHook(({ id }) => useThreadMessages(id, "m"), {
      initialProps: { id: THREAD_A },
    });
    await waitFor(() => expect(bodies(hook.result.current.state)).toEqual(["m0"]));
    stage.arrive();
    returnToTab();
    await settle();
    await act(async () => {
      await hook.result.current.send("m-sent");
    });
    expect(bodies(hook.result.current.state)).toContain("m-sent");
    return hook;
  }

  it("keeps the sent message when the gap page fails, and a retry still reaches it all", async () => {
    const stage = staged(60);
    const hook = await catchUpThenSend(stage);

    stage.held.resolve(respond({}, 500));
    await settle();

    expect(bodies(hook.result.current.state)).toContain("m-sent");
    await act(async () => {
      await hook.result.current.loadOlder();
    });
    const seen = bodies(hook.result.current.state);
    expect(seen).toHaveLength(stage.all().length);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("keeps it when the catch-up runs out of pages", async () => {
    const stage = staged(600);
    const hook = await catchUpThenSend(stage);

    stage.held.resolve(stage.heldPageNow());
    await settle();

    // Ten pages could not reach the one message held, so the newest stretch
    // stands alone — with the sent message still in it.
    expect(bodies(hook.result.current.state)).toContain("m-sent");
    expect(cursorOf(hook.result.current.state)).not.toBeNull();
  });

  it("keeps it when the gap closes", async () => {
    const stage = staged(60);
    const hook = await catchUpThenSend(stage);

    stage.held.resolve(stage.heldPageNow());
    await settle();

    const seen = bodies(hook.result.current.state);
    expect(seen).toContain("m-sent");
    expect(seen).toHaveLength(stage.all().length);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("leaves the next thread alone when the reader switches before it lands", async () => {
    const stage = staged(60);
    const hook = await catchUpThenSend(stage);

    hook.rerender({ id: THREAD_B });
    await waitFor(() => expect(hook.result.current.state.status).toBe("ok"));
    stage.held.resolve(respond({}, 500));
    await settle();

    expect(bodies(hook.result.current.state)).toEqual([]);
    expect(hook.result.current.loadingOlder).toBe(false);
    expect(cursorOf(hook.result.current.state)).toBeNull();
  });
});

describe("loading older pages", () => {
  /** Two threads of sixty: each opens on fifty with a cursor to ten more. */
  function twoThreads() {
    const threads: Record<string, Fixture[]> = {
      [THREAD_A]: history(THREAD_A, 0, 60),
      [THREAD_B]: history(THREAD_B, 0, 60),
    };
    const older: Record<string, ReturnType<typeof deferred<Answer>>> = {
      [THREAD_A]: deferred<Answer>(),
      [THREAD_B]: deferred<Answer>(),
    };
    stubFetch((url) => {
      const id = url.includes(THREAD_A) ? THREAD_A : THREAD_B;
      return url.includes("before=") ? older[id]!.promise : paged(threads[id]!, url);
    });
    const restOf = (id: string) => paged(threads[id]!, `/x?before=${threads[id]!.at(-50)!.id}`);
    return { older, restOf };
  }

  async function opened(initialProps: { id: string; q?: string }) {
    const hook = renderHook(({ id, q }: { id: string; q?: string }) => useThreadMessages(id, q), {
      initialProps,
    });
    await waitFor(() => expect(bodies(hook.result.current.state)).toHaveLength(50));
    return hook;
  }

  it("keeps A's late page, and its loading state, out of B", async () => {
    const { older, restOf } = twoThreads();
    const hook = await opened({ id: THREAD_A });
    act(() => {
      void hook.result.current.loadOlder();
    });
    expect(hook.result.current.loadingOlder).toBe(true);

    hook.rerender({ id: THREAD_B });
    await waitFor(() => expect(bodies(hook.result.current.state)).toHaveLength(50));
    // B starts free to page, whatever A is still doing.
    expect(hook.result.current.loadingOlder).toBe(false);
    act(() => {
      void hook.result.current.loadOlder();
    });

    older[THREAD_A]!.resolve(restOf(THREAD_A));
    await settle();
    // A's answer neither joins B's messages nor ends B's wait.
    expect(bodies(hook.result.current.state)).toHaveLength(50);
    expect(hook.result.current.loadingOlder).toBe(true);

    older[THREAD_B]!.resolve(restOf(THREAD_B));
    await settle();
    expect(bodies(hook.result.current.state)).toHaveLength(60);
    expect(hook.result.current.loadingOlder).toBe(false);
  });

  it("keeps A's late failure out of B", async () => {
    const { older } = twoThreads();
    const hook = await opened({ id: THREAD_A });
    act(() => {
      void hook.result.current.loadOlder();
    });
    hook.rerender({ id: THREAD_B });
    await waitFor(() => expect(bodies(hook.result.current.state)).toHaveLength(50));
    act(() => {
      void hook.result.current.loadOlder();
    });

    older[THREAD_A]!.resolve(respond({}, 500));
    await settle();

    expect(hook.result.current.olderError).toBeUndefined();
    expect(hook.result.current.loadingOlder).toBe(true);
  });

  it("treats a new search, and a return visit, as a new history", async () => {
    const { older, restOf } = twoThreads();
    const hook = await opened({ id: THREAD_A });
    act(() => {
      void hook.result.current.loadOlder();
    });

    hook.rerender({ id: THREAD_A, q: "m" });
    await waitFor(() => expect(hook.result.current.loadingOlder).toBe(false));
    hook.rerender({ id: THREAD_B });
    hook.rerender({ id: THREAD_A });
    await waitFor(() => expect(bodies(hook.result.current.state)).toHaveLength(50));

    older[THREAD_A]!.resolve(restOf(THREAD_A));
    await settle();

    // The page was asked for an earlier view of A; this visit pages on its own.
    expect(bodies(hook.result.current.state)).toHaveLength(50);
    expect(hook.result.current.loadingOlder).toBe(false);
  });
});

type Held = ReturnType<typeof useThreadMessages>["state"];

/** The held message with `id`, as the hook holds it. */
const held = (state: Held, id: string) =>
  state.status === "ok" ? state.items.find((item) => item.id === id) : undefined;

/** What the route answers a deletion with: the same row, emptied. */
const tombstoneOf = (fixture: Fixture) => ({
  ...fixture,
  body: "",
  deletedAt: new Date(Date.UTC(2026, 9, 2)).toISOString(),
  deletedBy: AUTHOR,
});

describe("deleting a message", () => {
  it("shows the tombstone only once the server has agreed", async () => {
    const said = message(THREAD_A, "Oops");
    const removal = deferred<Answer>();
    const fetchMock = stubFetch((url, method) =>
      method === "DELETE" ? removal.promise : respond({ messages: [said], nextCursor: null }),
    );
    const hook = renderHook(() => useThreadMessages(THREAD_A));
    await waitFor(() => expect(bodies(hook.result.current.state)).toEqual(["Oops"]));

    let result: Promise<unknown> = Promise.resolve();
    act(() => {
      result = hook.result.current.deleteMessage(held(hook.result.current.state, said.id)!);
    });
    expect(hook.result.current.deleting.has(said.id)).toBe(true);
    expect(bodies(hook.result.current.state)).toEqual(["Oops"]);

    await act(async () => {
      removal.resolve(respond({ message: tombstoneOf(said) }));
      await result;
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/threads/${THREAD_A}/messages/${said.id}`,
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(held(hook.result.current.state, said.id)).toMatchObject({ body: "" });
    expect(held(hook.result.current.state, said.id)!.deletedAt).not.toBeNull();
    expect(hook.result.current.deleting.has(said.id)).toBe(false);
  });

  it("keeps the message, with the server's reason, when it refuses", async () => {
    const said = message(THREAD_A, "Not yours");
    stubFetch((url, method) =>
      method === "DELETE"
        ? respond(
            { error: { code: "FORBIDDEN", message: "You can only delete your own messages." } },
            403,
          )
        : respond({ messages: [said], nextCursor: null }),
    );
    const hook = renderHook(() => useThreadMessages(THREAD_A));
    await waitFor(() => expect(bodies(hook.result.current.state)).toEqual(["Not yours"]));

    let result: unknown;
    await act(async () => {
      result = await hook.result.current.deleteMessage(held(hook.result.current.state, said.id)!);
    });

    expect(result).toBeUndefined();
    expect(bodies(hook.result.current.state)).toEqual(["Not yours"]);
    expect(hook.result.current.deleteErrors[said.id]).toBe(
      "You can only delete your own messages.",
    );
  });

  it("takes a deleted message out of the search results", async () => {
    const said = message(THREAD_A, "venue booked");
    stubFetch((url, method) =>
      method === "DELETE"
        ? respond({ message: tombstoneOf(said) })
        : respond({ messages: [said], nextCursor: null }),
    );
    const hook = renderHook(() => useThreadMessages(THREAD_A, "venue"));
    await waitFor(() => expect(bodies(hook.result.current.state)).toEqual(["venue booked"]));

    await act(async () => {
      await hook.result.current.deleteMessage(held(hook.result.current.state, said.id)!);
    });

    expect(bodies(hook.result.current.state)).toEqual([]);
  });

  it("never lets a read that started before the deletion bring the words back", async () => {
    const said = message(THREAD_A, "Secret");
    const stale = deferred<Answer>();
    let holding = false;
    stubFetch((url, method) => {
      if (method === "DELETE") return respond({ message: tombstoneOf(said) });
      return holding ? stale.promise : respond({ messages: [said], nextCursor: null });
    });
    const hook = renderHook(() => useThreadMessages(THREAD_A));
    await waitFor(() => expect(bodies(hook.result.current.state)).toEqual(["Secret"]));

    // A refresh reads the live message, and is slow to land.
    holding = true;
    returnToTab();
    await act(async () => {
      await hook.result.current.deleteMessage(held(hook.result.current.state, said.id)!);
    });
    stale.resolve(respond({ messages: [said], nextCursor: null }));
    await settle();

    expect(held(hook.result.current.state, said.id)).toMatchObject({ body: "" });
  });
});

describe("deletions made elsewhere", () => {
  it("show on the next refresh, even in an older page already loaded", async () => {
    let all = history(THREAD_A, 0, 60);
    stubFetch((url) => paged(all, url));
    const hook = renderHook(() => useThreadMessages(THREAD_A));
    await waitFor(() => expect(bodies(hook.result.current.state)).toHaveLength(50));
    await act(async () => {
      await hook.result.current.loadOlder();
    });
    expect(bodies(hook.result.current.state)).toContain("m5");

    // Deleted by someone else, well below the newest page.
    const target = all[5]!;
    all = all.map((item) => (item.id === target.id ? tombstoneOf(item) : item));
    returnToTab();

    await waitFor(() => expect(bodies(hook.result.current.state)).not.toContain("m5"));
    expect(held(hook.result.current.state, target.id)!.deletedAt).not.toBeNull();
    expect(bodies(hook.result.current.state)).toHaveLength(60);
    expect(cursorOf(hook.result.current.state)).toBeNull();
  });

  it("drop a search hit the server no longer returns", async () => {
    let all: Fixture[] = [message(THREAD_A, "venue one"), message(THREAD_A, "venue two")];
    stubFetch((url) =>
      paged(
        all.filter((item) => item.deletedAt === null && item.body.includes("venue")),
        url,
      ),
    );
    const hook = renderHook(() => useThreadMessages(THREAD_A, "venue"));
    await waitFor(() => expect(bodies(hook.result.current.state)).toHaveLength(2));

    all = all.map((item) => (item.body === "venue one" ? tombstoneOf(item) : item));
    returnToTab();

    await waitFor(() => expect(bodies(hook.result.current.state)).toEqual(["venue two"]));
  });

  it("clear a thread the server stops showing, and say so", async () => {
    let gone = false;
    stubFetch(() =>
      gone
        ? respond({ error: { code: "THREAD_NOT_FOUND", message: "Thread not found." } }, 404)
        : respond({ messages: [message(THREAD_A, "hello")], nextCursor: null }),
    );
    const onGone = vi.fn();
    const hook = renderHook(() => useThreadMessages(THREAD_A, "", { onGone }));
    await waitFor(() => expect(bodies(hook.result.current.state)).toEqual(["hello"]));

    gone = true;
    returnToTab();

    await waitFor(() => expect(hook.result.current.state.status).toBe("gone"));
    expect(onGone).toHaveBeenCalledWith(THREAD_A);
  });

  it("leave what is on screen when a refresh fails for any other reason", async () => {
    let failing = false;
    stubFetch(() =>
      failing
        ? respond({}, 500)
        : respond({ messages: [message(THREAD_A, "hello")], nextCursor: null }),
    );
    const hook = renderHook(() => useThreadMessages(THREAD_A));
    await waitFor(() => expect(bodies(hook.result.current.state)).toEqual(["hello"]));

    failing = true;
    returnToTab();
    await settle();

    expect(bodies(hook.result.current.state)).toEqual(["hello"]);
  });
});

describe("deleting a group", () => {
  const GROUP = THREAD_A;
  const OTHER = THREAD_B;
  const group = (id: string, name: string) => ({
    id,
    kind: "group",
    name,
    teamId: null,
    eventId: null,
    minTier: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    createdBy: AUTHOR,
    memberIds: [AUTHOR],
    lastReadAt: null,
    unreadCount: 1,
    lastMessageAt: null,
  });
  const names = (state: ReturnType<typeof useThreads>["state"]) =>
    state.status === "ok" ? state.items.map((item) => item.name) : [];
  const first = (state: ReturnType<typeof useThreads>["state"]) =>
    (state as { items: Thread[] }).items[0]!;

  /** `GET /api/threads` answers in turn from `lists`, the last one repeating. */
  function stubList(
    lists: (Answer | Promise<Answer>)[],
    onWrite: (url: string, method: string) => Answer | Promise<Answer>,
  ) {
    let reads = 0;
    return stubFetch((url, method) => {
      if (method !== "GET") return onWrite(url, method);
      const answer = lists[Math.min(reads, lists.length - 1)]!;
      reads += 1;
      return answer;
    });
  }

  it("drops it once the server agrees, and a list read from before cannot bring it back", async () => {
    const stale = deferred<Answer>();
    const both = respond({ threads: [group(GROUP, "Logistics"), group(OTHER, "Sponsors")] });
    const fetchMock = stubList(
      [both, stale.promise, respond({ threads: [group(OTHER, "Sponsors")] })],
      () => respond(null, 204),
    );
    const hook = renderHook(() => useThreads());
    await waitFor(() =>
      expect(names(hook.result.current.state)).toEqual(["Logistics", "Sponsors"]),
    );

    returnToTab();
    let deleted: unknown;
    await act(async () => {
      deleted = await hook.result.current.deleteGroup(first(hook.result.current.state));
    });
    stale.resolve(both);
    await settle();

    expect(deleted).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/threads/${GROUP}`,
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(names(hook.result.current.state)).toEqual(["Sponsors"]);
  });

  it("leaves it, with the reason, when the server refuses", async () => {
    stubList([respond({ threads: [group(GROUP, "Logistics")] })], () =>
      respond({ error: { code: "FORBIDDEN", message: "You cannot delete this group." } }, 403),
    );
    const hook = renderHook(() => useThreads());
    await waitFor(() => expect(names(hook.result.current.state)).toEqual(["Logistics"]));

    let deleted: unknown;
    await act(async () => {
      deleted = await hook.result.current.deleteGroup(first(hook.result.current.state));
    });

    expect(deleted).toBe(false);
    expect(names(hook.result.current.state)).toEqual(["Logistics"]);
    expect(hook.result.current.deleteError).toEqual({
      threadId: GROUP,
      message: "You cannot delete this group.",
    });
  });

  it("treats a group someone else already deleted as deleted", async () => {
    stubList([respond({ threads: [group(GROUP, "Logistics")] }), respond({ threads: [] })], () =>
      respond({ error: { code: "THREAD_NOT_FOUND", message: "Thread not found." } }, 404),
    );
    const hook = renderHook(() => useThreads());
    await waitFor(() => expect(names(hook.result.current.state)).toEqual(["Logistics"]));

    await act(async () => {
      await hook.result.current.deleteGroup(first(hook.result.current.state));
    });

    expect(names(hook.result.current.state)).toEqual([]);
    expect(hook.result.current.deleteError).toBeUndefined();
  });

  it("never lets a late mark-read answer put it back", async () => {
    const read = deferred<Answer>();
    stubList(
      [respond({ threads: [group(GROUP, "Logistics")] }), respond({ threads: [] })],
      (url, method) => (method === "POST" ? read.promise : respond(null, 204)),
    );
    const hook = renderHook(() => useThreads());
    await waitFor(() => expect(names(hook.result.current.state)).toEqual(["Logistics"]));
    const logistics = first(hook.result.current.state);

    let marking: Promise<unknown> = Promise.resolve();
    act(() => {
      marking = hook.result.current.markRead(logistics);
    });
    await act(async () => {
      await hook.result.current.deleteGroup(logistics);
    });
    await act(async () => {
      read.resolve(respond({ thread: { ...group(GROUP, "Logistics"), unreadCount: 0 } }));
      await marking;
    });

    expect(names(hook.result.current.state)).toEqual([]);
  });
});

describe("review regressions", () => {
  it("preserves the older page loaded while a refresh crosses its original floor", async () => {
    let all = history(THREAD_A, 0, 150);
    const delayed = deferred<Answer>();
    let refreshing = false;
    let delayedUrl: string | undefined;
    stubFetch((url) => {
      if (refreshing && url.includes("before=" + all[101]!.id)) {
        delayedUrl = url;
        return delayed.promise;
      }
      return paged(all, url);
    });
    const hook = renderHook(() => useThreadMessages(THREAD_A));
    await waitFor(() => expect(bodies(hook.result.current.state)).toHaveLength(50));
    all = [...all, ...history(THREAD_A, 150, 1)];
    refreshing = true;
    returnToTab();
    await waitFor(() => expect(delayedUrl).toBeDefined());
    await act(async () => {
      await hook.result.current.loadOlder();
    });
    expect(bodies(hook.result.current.state)).toHaveLength(100);
    delayed.resolve(paged(all, delayedUrl!));
    await settle();
    expect(bodies(hook.result.current.state)).toHaveLength(101);
    expect(bodies(hook.result.current.state)).toContain("m99");
    expect(cursorOf(hook.result.current.state)).toBe(all[50]!.id);
    refreshing = false;
    await act(async () => {
      await hook.result.current.loadOlder();
    });
    expect(new Set(bodies(hook.result.current.state)).size).toBe(151);
  });

  it.each(["", "venue"])(
    "never revives a known deletion from a late send, query %j",
    async (query) => {
      const post = deferred<Answer>();
      const live = message(THREAD_A, "venue booked");
      let visible = false;
      stubFetch((_url, method) => {
        if (method === "POST") return post.promise;
        if (method === "DELETE") return respond({ message: tombstoneOf(live) });
        return respond({ messages: visible ? [live] : [], nextCursor: null });
      });
      const hook = renderHook(() => useThreadMessages(THREAD_A, query));
      await waitFor(() => expect(hook.result.current.state.status).toBe("ok"));
      let sending: Promise<unknown> = Promise.resolve();
      act(() => {
        sending = hook.result.current.send(live.body);
      });
      visible = true;
      returnToTab();
      await waitFor(() => expect(bodies(hook.result.current.state)).toEqual([live.body]));
      await act(async () => {
        await hook.result.current.deleteMessage(held(hook.result.current.state, live.id)!);
      });
      await act(async () => {
        post.resolve(respond({ message: live }, 201));
        await sending;
      });
      expect(bodies(hook.result.current.state)).toEqual(query ? [] : [""]);
    },
  );
});

it("keeps the API sequence when distinct database timestamps round to the same millisecond", async () => {
  const newer = {
    ...message(THREAD_A, "newer microsecond"),
    createdAt: "2026-10-10T12:00:00.000Z",
  };
  const older = { ...message(THREAD_A, "older microsecond"), createdAt: newer.createdAt };
  // The newer transaction started later but allocated its UUID earlier. Dates
  // in the JSON response lose PostgreSQL's microseconds; its sequence must win.
  const fetchMock = stubFetch(() => respond({ messages: [newer, older], nextCursor: older.id }));
  const hook = renderHook(() => useThreadMessages(THREAD_A));
  await waitFor(() => expect(hook.result.current.state.status).toBe("ok"));
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(hook.result.current.state).toMatchObject({
      items: [{ id: newer.id }, { id: older.id }],
    }),
  );
});

it("retains a delayed send already seen at the history boundary by a read", async () => {
  const all = Array.from({ length: 150 }, (_, i) => message(THREAD_A, "history " + i));
  const pending = deferred<Answer>();
  stubFetch((url, method) =>
    method === "POST"
      ? pending.promise
      : url.includes("q=missing")
        ? respond({ messages: [], nextCursor: null })
        : respond({ messages: all.slice(100).reverse(), nextCursor: all[100]!.id }),
  );
  const hook = renderHook(({ q }) => useThreadMessages(THREAD_A, q), {
    initialProps: { q: "missing" },
  });
  await waitFor(() => expect(hook.result.current.state.status).toBe("ok"));
  let sending!: Promise<unknown>;
  act(() => {
    sending = hook.result.current.send(all[100]!.body);
  });
  hook.rerender({ q: "" });
  await waitFor(() =>
    expect(hook.result.current.state).toMatchObject({ items: Array(50).fill({}) }),
  );
  await act(async () => {
    pending.resolve(respond({ message: all[100] }, 201));
    await sending;
  });
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  await waitFor(() =>
    expect(hook.result.current.state).toMatchObject({
      items: all
        .slice(100)
        .reverse()
        .map((item) => ({ id: item.id })),
    }),
  );
});

it("receives messages and tombstones on a three-second poll without focus or input", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const incoming = message(THREAD_A, "Arrived while idle");
  let page = { messages: [] as ReturnType<typeof message>[], nextCursor: null };
  stubFetch(() => respond(page));
  const hook = renderHook(() => useThreadMessages(THREAD_A));
  await waitFor(() => expect(hook.result.current.state.status).toBe("ok"));
  try {
    page = { messages: [incoming], nextCursor: null };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(bodies(hook.result.current.state)).toEqual([incoming.body]);
    page = {
      messages: [{ ...incoming, body: "", deletedAt: new Date().toISOString(), deletedBy: AUTHOR }],
      nextCursor: null,
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(bodies(hook.result.current.state)).toEqual([""]);
  } finally {
    hook.unmount();
    vi.useRealTimers();
  }
});

it("shows a rejected mention's reason without adding a message", async () => {
  stubFetch((_url, method) =>
    method === "POST"
      ? respond(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Request validation failed",
              fields: {
                body: ["Mention only people who belong to this conversation."],
              },
            },
          },
          422,
        )
      : undefined,
  );
  const hook = renderHook(() => useThreadMessages(THREAD_A));
  await waitFor(() => expect(hook.result.current.state.status).toBe("ok"));
  await act(async () => {
    await hook.result.current.send("@[" + AUTHOR + "]");
  });
  expect(hook.result.current.sendError).toBe(
    "Mention only people who belong to this conversation.",
  );
  expect(bodies(hook.result.current.state)).toEqual([]);
});
