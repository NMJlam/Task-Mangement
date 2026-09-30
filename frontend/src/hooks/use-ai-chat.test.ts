import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAiChat } from "./use-ai-chat";

const CHAT_ID = "018f3a4b-0000-7000-8000-0000000000c1";
const RUN_ID = "018f3a4b-0000-7000-8000-000000000010";
const EVENT_ID = "018f3a4b-0000-7000-8000-000000000011";
const MESSAGE_A = "018f3a4b-0000-7000-8000-0000000000d1";
const MESSAGE_B = "018f3a4b-0000-7000-8000-0000000000d2";

afterEach(() => vi.unstubAllGlobals());

const respond = (status: number, body?: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const chat = {
  id: CHAT_ID,
  title: "Plan it",
  seedEventId: null,
  lastMessageAt: "2026-10-01T02:00:00.000Z",
  createdAt: "2026-10-01T01:00:00.000Z",
};

const plan = {
  createTasks: [
    { title: "Book room", priority: "medium", dueAt: "2026-11-17T12:59:00.000Z", assignees: [] },
  ],
};

const stored = (status: "open" | "applied" | "discarded" | null = "open") => ({
  chat,
  messages: [
    {
      id: MESSAGE_A,
      role: "member",
      body: "Plan it",
      createdAt: "2026-10-01T01:00:00.000Z",
      runId: null,
      proposal: null,
      proposalStatus: null,
      applied: null,
    },
    {
      id: MESSAGE_B,
      role: "assistant",
      body: "Here is a plan.",
      createdAt: "2026-10-01T01:00:05.000Z",
      runId: RUN_ID,
      proposal: status ? plan : null,
      proposalStatus: status,
      applied:
        status === "applied"
          ? { events: [], tasks: [{ id: EVENT_ID, title: "Book room", eventId: null }] }
          : null,
    },
  ],
});

const sent = (proposal: unknown = null) => ({
  chatId: CHAT_ID,
  runId: RUN_ID,
  reply: "Here is a plan.",
  proposal,
});

const bodies = (state: ReturnType<typeof useAiChat>["state"]) =>
  state.status === "ok" ? state.messages.map((message) => message.body) : [];

it("is blank with no chat id, and fetches nothing", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useAiChat(undefined));

  expect(result.current.state.status).toBe("blank");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("loads a chat's messages, with its plan under the reply", async () => {
  const fetchMock = vi.fn().mockResolvedValue(respond(200, stored()));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useAiChat(CHAT_ID));

  await waitFor(() => expect(result.current.state.status).toBe("ok"));
  expect(fetchMock).toHaveBeenCalledWith(`/api/ai/chats/${CHAT_ID}/messages`, expect.anything());
  expect(bodies(result.current.state)).toEqual(["Plan it", "Here is a plan."]);
  const state = result.current.state;
  const reply = state.status === "ok" ? state.messages[1]! : undefined;
  expect(reply).toMatchObject({ runId: RUN_ID, proposalStatus: "open" });
  expect(reply?.proposal?.createTasks?.[0]?.dueAt).toEqual(new Date("2026-11-17T12:59:00.000Z"));
});

it("reports a chat that no longer exists as missing", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(respond(404, { error: { code: "CHAT_NOT_FOUND", message: "Gone." } })),
  );

  const { result } = renderHook(() => useAiChat(CHAT_ID));

  await waitFor(() => expect(result.current.state.status).toBe("missing"));
});

it("shows the member's message at once, then the reply, and reports the new chat", async () => {
  let answer!: (value: ReturnType<typeof respond>) => void;
  const fetchMock = vi.fn(
    () => new Promise<ReturnType<typeof respond>>((resolve) => (answer = resolve)),
  );
  vi.stubGlobal("fetch", fetchMock);
  const onChatCreated = vi.fn();
  const onChanged = vi.fn();
  const { result } = renderHook(() =>
    useAiChat(undefined, { seed: { eventId: EVENT_ID }, onChatCreated, onChanged }),
  );

  let outcome: Promise<boolean>;
  act(() => {
    outcome = result.current.send("Plan it");
  });

  await waitFor(() => expect(bodies(result.current.state)).toEqual(["Plan it"]));
  expect(result.current.thinking).toBe(true);

  await act(async () => {
    answer(respond(200, sent()));
    expect(await outcome).toBe(true);
  });

  expect(bodies(result.current.state)).toEqual(["Plan it", "Here is a plan."]);
  expect(result.current.thinking).toBe(false);
  expect(onChatCreated).toHaveBeenCalledWith(CHAT_ID);
  expect(onChanged).toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/ai/messages",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ text: "Plan it", seed: { eventId: EVENT_ID } }),
    }),
  );
});

it("sends into an existing chat by id, without the seed or a new-chat report", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(respond(200, stored(null)))
    .mockResolvedValueOnce(respond(200, sent()));
  vi.stubGlobal("fetch", fetchMock);
  const onChatCreated = vi.fn();
  const { result } = renderHook(() =>
    useAiChat(CHAT_ID, { seed: { eventId: EVENT_ID }, onChatCreated }),
  );
  await waitFor(() => expect(result.current.state.status).toBe("ok"));

  await act(() => result.current.send("And then?"));

  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/ai/messages",
    expect.objectContaining({ body: JSON.stringify({ chatId: CHAT_ID, text: "And then?" }) }),
  );
  expect(onChatCreated).not.toHaveBeenCalled();
  expect(bodies(result.current.state).at(-1)).toBe("Here is a plan.");
});

it("does not refetch the chat it just created", async () => {
  const fetchMock = vi.fn().mockResolvedValue(respond(200, sent()));
  vi.stubGlobal("fetch", fetchMock);
  const { result, rerender } = renderHook(({ id }: { id?: string }) => useAiChat(id), {
    initialProps: { id: undefined as string | undefined },
  });

  await act(() => result.current.send("Plan it"));
  // The page moves to /ai/:chatId, which hands the hook the id it already holds.
  rerender({ id: CHAT_ID });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(bodies(result.current.state)).toEqual(["Plan it", "Here is a plan."]);
});

it("puts a drafted plan on its reply, open", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(200, sent(plan))));
  const { result } = renderHook(() => useAiChat(undefined));

  await act(() => result.current.send("Plan it"));

  const state = result.current.state;
  expect(state.status === "ok" && state.messages.at(-1)).toMatchObject({
    role: "assistant",
    runId: RUN_ID,
    proposalStatus: "open",
    proposal: { createTasks: [expect.objectContaining({ title: "Book room" })] },
  });
});

it("takes a failed turn back out and says why, leaving the composer on", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        respond(503, { error: { code: "AI_UNAVAILABLE", message: "The AI service is busy." } }),
      ),
  );
  const { result } = renderHook(() => useAiChat(undefined));

  let ok = true;
  await act(async () => {
    ok = await result.current.send("Plan it");
  });

  expect(ok).toBe(false);
  // Nothing was saved, so nothing stays on screen: the page puts the text back in the box.
  expect(result.current.state.status).toBe("blank");
  expect(result.current.error).toBe("The AI service is busy.");
  expect(result.current.disabled).toBe(false);
});

it("turns the composer off when the assistant is disabled, without calling it an error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(respond(503, { error: { code: "AI_DISABLED", message: "Off." } })),
  );
  const { result } = renderHook(() => useAiChat(undefined));

  await act(() => result.current.send("Plan it"));

  expect(result.current.disabled).toBe(true);
  expect(result.current.error).toBeUndefined();
});

it("applies a plan against its run, then reloads the chat to show what it made", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(respond(200, stored("open")))
    .mockResolvedValueOnce(
      respond(201, { events: [], tasks: [{ id: EVENT_ID, title: "Book room" }] }),
    )
    .mockResolvedValueOnce(respond(200, stored("applied")));
  vi.stubGlobal("fetch", fetchMock);
  const onChanged = vi.fn();
  const { result } = renderHook(() => useAiChat(CHAT_ID, { onChanged }));
  await waitFor(() => expect(result.current.state.status).toBe("ok"));
  const stats = { proposed: 1, kept: 1, edited: 0 };

  let ok = false;
  await act(async () => {
    ok = await result.current.apply(RUN_ID, [], stats);
  });

  expect(ok).toBe(true);
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    "/api/ai/proposals/apply",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ runId: RUN_ID, operations: [], stats }),
    }),
  );
  const state = result.current.state;
  expect(state.status === "ok" && state.messages[1]).toMatchObject({
    proposalStatus: "applied",
    applied: { tasks: [{ title: "Book room" }] },
  });
  expect(onChanged).toHaveBeenCalled();
});

it("reloads and says why when the plan was already closed", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(respond(200, stored("open")))
    .mockResolvedValueOnce(
      respond(409, { error: { code: "PROPOSAL_CLOSED", message: "Already applied." } }),
    )
    .mockResolvedValueOnce(respond(200, stored("applied")));
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useAiChat(CHAT_ID));
  await waitFor(() => expect(result.current.state.status).toBe("ok"));

  let ok = true;
  await act(async () => {
    ok = await result.current.apply(RUN_ID, [], { proposed: 1, kept: 1, edited: 0 });
  });

  expect(ok).toBe(false);
  expect(result.current.error).toBe("Already applied.");
  // The card is replaced by the plan's real status, not left looking live.
  const state = result.current.state;
  expect(state.status === "ok" && state.messages[1]!.proposalStatus).toBe("applied");
});

it("discards a plan, then reloads the chat", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(respond(200, stored("open")))
    .mockResolvedValueOnce(respond(204))
    .mockResolvedValueOnce(respond(200, stored("discarded")));
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useAiChat(CHAT_ID));
  await waitFor(() => expect(result.current.state.status).toBe("ok"));

  await act(() => result.current.discard(RUN_ID));

  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    `/api/ai/proposals/${RUN_ID}/discard`,
    expect.objectContaining({ method: "POST" }),
  );
  const state = result.current.state;
  expect(state.status === "ok" && state.messages[1]!.proposalStatus).toBe("discarded");
});
