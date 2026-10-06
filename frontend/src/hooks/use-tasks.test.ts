import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MAX_TASKS, useTasks } from "./use-tasks";

afterEach(() => vi.unstubAllGlobals());

/** A task as `/api/tasks` reports it, numbered so every id is distinct. */
function task(n: number) {
  return {
    id: `018f3a4b-0000-7000-8000-${String(n).padStart(12, "0")}`,
    eventId: null,
    teamId: null,
    assigneeIds: [],
    creator: null,
    title: `Task ${n}`,
    description: null,
    status: "todo",
    priority: "medium",
    dueAt: null,
    boardOrder: 0,
    minTier: 0,
    completedAt: null,
    aiRunId: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

const range = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => task(from + index));

/** Answers each page with what `page` returns for its offset and limit. */
function stubPages(page: (offset: number, limit: number) => ReturnType<typeof task>[]) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ tasks: page(offset, limit) }),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const loaded = async (hook: { result: { current: ReturnType<typeof useTasks> } }) => {
  await waitFor(() => expect(hook.result.current.state.status).toBe("ok"));
  const state = hook.result.current.state;
  if (state.status !== "ok") throw new Error("not loaded");
  return state;
};

it("reads past the API's first page until a short page says there is no more", async () => {
  const fetchMock = stubPages((offset, limit) =>
    offset === 0 ? range(0, limit) : range(offset, 3),
  );

  const state = await loaded(renderHook(() => useTasks({ eventId: undefined })));

  expect(state.items).toHaveLength(53);
  expect(state.truncated).toBe(false);
  // The first request is the one the board always made; only the rest page.
  expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
    "/api/tasks",
    "/api/tasks?limit=100&offset=50",
  ]);
});

it("keeps the filters on every page", async () => {
  const fetchMock = stubPages((offset, limit) => (offset === 0 ? range(0, limit) : []));

  await loaded(renderHook(() => useTasks({ priority: "urgent" })));

  expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
    "/api/tasks?priority=urgent",
    "/api/tasks?priority=urgent&limit=100&offset=50",
  ]);
});

it("keeps a task once when a page shifts under it", async () => {
  // The second page starts with the first page's last task, as an insert
  // between the two reads would make it.
  stubPages((offset, limit) => (offset === 0 ? range(0, limit) : range(offset - 1, 3)));

  const state = await loaded(renderHook(() => useTasks()));

  expect(new Set(state.items.map((item) => item.id)).size).toBe(state.items.length);
  expect(state.items).toHaveLength(52);
});

it("stops at the ceiling and says the board may be partial", async () => {
  const fetchMock = stubPages((offset, limit) => range(offset, limit));

  const state = await loaded(renderHook(() => useTasks()));

  expect(state.truncated).toBe(true);
  expect(state.items.length).toBeGreaterThanOrEqual(MAX_TASKS);
  expect(fetchMock.mock.calls.length).toBeLessThan(15);
});
