import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAiChats } from "./use-ai-chats";

const CHAT_A = "018f3a4b-0000-7000-8000-0000000000a1";
const CHAT_B = "018f3a4b-0000-7000-8000-0000000000b2";

afterEach(() => vi.unstubAllGlobals());

const chat = (id: string, title: string) => ({
  id,
  title,
  seedEventId: null,
  lastMessageAt: "2026-10-01T02:00:00.000Z",
  createdAt: "2026-10-01T01:00:00.000Z",
});

const respond = (status: number, body?: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** Answers the list, and whatever each test says a rename or delete should get. */
function stubChats(
  answers: { rename?: ReturnType<typeof respond>; remove?: ReturnType<typeof respond> } = {},
) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/ai/chats" && method === "GET") {
      return Promise.resolve(
        respond(200, { chats: [chat(CHAT_A, "Hack plan"), chat(CHAT_B, "Overdue?")] }),
      );
    }
    if (method === "PATCH" && answers.rename) return Promise.resolve(answers.rename);
    if (method === "DELETE" && answers.remove) return Promise.resolve(answers.remove);
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function loaded() {
  const hook = renderHook(() => useAiChats());
  await waitFor(() => expect(hook.result.current.state.status).toBe("ok"));
  return hook;
}

const titles = (state: ReturnType<typeof useAiChats>["state"]) =>
  state.status === "ok" ? state.items.map((item) => item.title) : [];

it("loads the member's chats, with their times as dates", async () => {
  stubChats();

  const { result } = await loaded();

  expect(titles(result.current.state)).toEqual(["Hack plan", "Overdue?"]);
  const state = result.current.state;
  expect(state.status === "ok" && state.items[0]!.lastMessageAt).toBeInstanceOf(Date);
});

it("renames a chat in place", async () => {
  const fetchMock = stubChats({
    rename: respond(200, { chat: chat(CHAT_A, "Hack night plan") }),
  });
  const { result } = await loaded();
  const target = result.current.state.status === "ok" ? result.current.state.items[0]! : undefined;

  let renamed = false;
  await act(async () => {
    renamed = await result.current.rename(target!, "Hack night plan");
  });

  expect(renamed).toBe(true);
  expect(fetchMock).toHaveBeenCalledWith(
    `/api/ai/chats/${CHAT_A}`,
    expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ title: "Hack night plan" }),
    }),
  );
  expect(titles(result.current.state)).toEqual(["Hack night plan", "Overdue?"]);
});

it("keeps the list and says why when a rename is refused", async () => {
  stubChats({
    rename: respond(422, { error: { code: "VALIDATION_ERROR", message: "Title is required" } }),
  });
  const { result } = await loaded();
  const target = result.current.state.status === "ok" ? result.current.state.items[0]! : undefined;

  let renamed = true;
  await act(async () => {
    renamed = await result.current.rename(target!, " ");
  });

  expect(renamed).toBe(false);
  expect(result.current.mutationError).toBe("Title is required");
  expect(titles(result.current.state)).toEqual(["Hack plan", "Overdue?"]);
});

it("removes a chat from the list", async () => {
  const fetchMock = stubChats({ remove: respond(204) });
  const { result } = await loaded();
  const target = result.current.state.status === "ok" ? result.current.state.items[0]! : undefined;

  let removed = false;
  await act(async () => {
    removed = await result.current.remove(target!);
  });

  expect(removed).toBe(true);
  expect(fetchMock).toHaveBeenCalledWith(
    `/api/ai/chats/${CHAT_A}`,
    expect.objectContaining({ method: "DELETE" }),
  );
  expect(titles(result.current.state)).toEqual(["Overdue?"]);
});

it("reads the list again on refresh, so a chat made elsewhere shows up", async () => {
  const fetchMock = stubChats();
  const { result } = await loaded();

  await act(() => result.current.refresh());

  expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/ai/chats")).toHaveLength(2);
});

it("reports a list that could not be loaded", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(500, {})));

  const { result } = renderHook(() => useAiChats());

  await waitFor(() => expect(result.current.state.status).toBe("error"));
});
