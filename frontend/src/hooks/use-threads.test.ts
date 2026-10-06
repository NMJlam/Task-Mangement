import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
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
