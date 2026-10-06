import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useThreadMessages } from "./use-threads";

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
