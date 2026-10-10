import { MESSAGE_BODY_MAX } from "@ctp/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useThreadChat } from "./use-thread-chat";
import { EMPTY_DRAFT_STATE, type DraftState } from "@/lib/mention-draft";

const THREAD_A = "018f3a4b-0000-7000-8000-0000000000a1";
const THREAD_B = "018f3a4b-0000-7000-8000-0000000000b2";
const GLENN = "018f3a4b-0000-7000-8000-0000000000c3";

afterEach(() => vi.unstubAllGlobals());

const respond = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** `text` with "@Glenn" picked at its start. */
function mentioning(text: string): DraftState {
  return {
    ...EMPTY_DRAFT_STATE,
    draft: {
      text: `@Glenn ${text}`,
      mentions: [{ start: 0, end: 6, userId: GLENN, display: "@Glenn" }],
    },
  };
}

function stub(post: () => ReturnType<typeof respond>) {
  const fetchMock = vi.fn(async (_input: string, init?: RequestInit) =>
    init?.method === "POST" ? post() : respond({ messages: [], nextCursor: null }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const posts = (fetchMock: ReturnType<typeof stub>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

it("measures a draft as sent, and keeps every word of one that is too long", async () => {
  const fetchMock = stub(() => respond({}, 500));
  const hook = renderHook(() => useThreadChat(THREAD_A));
  await waitFor(() => expect(hook.result.current.messages.state.status).toBe("ok"));
  // Under the limit on screen; over it once "@Glenn" becomes its 39-character token.
  const draft = mentioning("x".repeat(MESSAGE_BODY_MAX - 10));
  act(() => hook.result.current.setDraft(draft));

  act(() => hook.result.current.send());

  expect(hook.result.current.draftError).toMatch(/limit is 4000/);
  expect(hook.result.current.draft).toBe(draft);
  expect(posts(fetchMock)).toEqual([]);

  // Editing the draft clears the complaint about the old one.
  act(() => hook.result.current.setDraft(mentioning("short")));
  expect(hook.result.current.draftError).toBeUndefined();
});

it("sends mentions as ids, and keeps the draft and its mentions when the send fails", async () => {
  const fetchMock = stub(() => respond({}, 500));
  const hook = renderHook(() => useThreadChat(THREAD_A));
  await waitFor(() => expect(hook.result.current.messages.state.status).toBe("ok"));
  const draft = mentioning("can you check?");
  act(() => hook.result.current.setDraft(draft));

  act(() => hook.result.current.send());

  await waitFor(() => expect(hook.result.current.messages.sendError).toBeDefined());
  expect(JSON.parse(String(posts(fetchMock)[0]![1]!.body))).toEqual({
    body: `@[${GLENN}] can you check?`,
  });
  expect(hook.result.current.draft).toBe(draft);
});

/** The row the route stores for a send. */
const stored = () =>
  respond(
    {
      message: {
        id: "018f3a4b-0000-7000-8000-0000000000d4",
        channelId: THREAD_A,
        taskId: null,
        parentId: null,
        author: GLENN,
        body: "@[" + GLENN + "] hi",
        fileKey: null,
        fileName: null,
        fileSizeBytes: null,
        fileMime: null,
        aiRunId: null,
        createdAt: "2026-10-10T00:00:00.000Z",
        editedAt: null,
        deletedAt: null,
        deletedBy: null,
      },
    },
    201,
  );

it("clears the draft and its mentions once the send is stored", async () => {
  stub(stored);
  const onSent = vi.fn();
  const hook = renderHook(() => useThreadChat(THREAD_A, { onSent }));
  await waitFor(() => expect(hook.result.current.messages.state.status).toBe("ok"));
  act(() => hook.result.current.setDraft(mentioning("hi")));

  act(() => hook.result.current.send());

  await waitFor(() => expect(hook.result.current.draft).toEqual(EMPTY_DRAFT_STATE));
  expect(onSent).toHaveBeenCalledTimes(1);
});

it("keeps what was typed after Enter while the send was still in flight", async () => {
  let land: (value: ReturnType<typeof respond>) => void = () => undefined;
  const fetchMock = vi.fn(async (_input: string, init?: RequestInit) =>
    init?.method === "POST"
      ? new Promise<ReturnType<typeof respond>>((resolve) => {
          land = resolve;
        })
      : respond({ messages: [], nextCursor: null }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const onSent = vi.fn();
  const hook = renderHook(() => useThreadChat(THREAD_A, { onSent }));
  await waitFor(() => expect(hook.result.current.messages.state.status).toBe("ok"));
  act(() => hook.result.current.setDraft(mentioning("hi")));
  act(() => hook.result.current.send());

  // The next message, started before the first one landed.
  const next = mentioning("and another thing");
  act(() => hook.result.current.setDraft(next));
  await act(async () => land(stored()));

  await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
  expect(hook.result.current.draft).toBe(next);
});

it("starts every conversation with an empty draft, mentions and history included", async () => {
  stub(() => respond({}, 500));
  const hook = renderHook(({ id }) => useThreadChat(id), { initialProps: { id: THREAD_A } });
  await waitFor(() => expect(hook.result.current.messages.state.status).toBe("ok"));
  act(() => hook.result.current.setDraft(mentioning("for A")));

  hook.rerender({ id: THREAD_B });
  expect(hook.result.current.draft).toEqual(EMPTY_DRAFT_STATE);
  hook.rerender({ id: THREAD_A });
  await waitFor(() => expect(hook.result.current.messages.state.status).toBe("ok"));
  expect(hook.result.current.draft).toEqual(EMPTY_DRAFT_STATE);
});
