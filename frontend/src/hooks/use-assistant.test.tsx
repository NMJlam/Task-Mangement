import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAssistant } from "./use-assistant";

const RUN_ID = "018f3a4b-0000-7000-8000-000000000010";
const EVENT_ID = "018f3a4b-0000-7000-8000-000000000011";

afterEach(() => vi.unstubAllGlobals());

function respond(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const planReply = {
  runId: RUN_ID,
  reply: "Here is a plan.",
  proposal: {
    createTasks: [
      {
        title: "Book room",
        priority: "medium",
        dueAt: "2026-11-17T12:59:00.000Z",
        assignees: [],
      },
    ],
  },
};

it("posts the member's message with the seed and shows the reply", async () => {
  const fetchMock = vi.fn().mockResolvedValue(respond(200, { ...planReply, proposal: null }));
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useAssistant({ eventId: EVENT_ID }));

  await act(() => result.current.send("What's overdue?"));

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/ai/messages",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ text: "What's overdue?", seed: { eventId: EVENT_ID } }),
    }),
  );
  expect(result.current.state).toMatchObject({
    status: "ok",
    turns: [
      { role: "member", text: "What's overdue?" },
      { role: "assistant", text: "Here is a plan." },
    ],
    staged: undefined,
  });
});

it("stages a proposal, with its dates parsed, for the card to render", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(200, planReply)));
  const { result } = renderHook(() => useAssistant());

  await act(() => result.current.send("Plan it"));

  const state = result.current.state;
  expect(state.status === "ok" && state.staged?.runId).toBe(RUN_ID);
  expect(state.status === "ok" && state.staged?.proposal.createTasks?.[0]?.dueAt).toEqual(
    new Date("2026-11-17T12:59:00.000Z"),
  );
});

it("applies the staged card against its run, then clears it", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(respond(200, planReply))
    .mockResolvedValueOnce(
      respond(201, { events: [], tasks: [{ id: EVENT_ID, title: "Book room" }] }),
    );
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useAssistant());
  await act(() => result.current.send("Plan it"));

  const stats = { proposed: 1, kept: 1, edited: 0 };
  await act(() => result.current.apply([], stats));

  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/ai/proposals/apply",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ runId: RUN_ID, operations: [], stats }),
    }),
  );
  await waitFor(() =>
    expect(result.current.state).toMatchObject({ status: "ok", staged: undefined }),
  );
});

it("treats a 503 as the assistant being off, not as an error", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        respond(503, { error: { code: "AI_DISABLED", message: "The assistant is off." } }),
      ),
  );
  const { result } = renderHook(() => useAssistant());

  await act(() => result.current.send("Hello"));

  expect(result.current.state.status).toBe("disabled");
  expect(result.current.error).toBeUndefined();
});

it("keeps the chat usable and relays the message when the AI service is only busy", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      respond(503, {
        error: { code: "AI_UNAVAILABLE", message: "The AI service is busy right now." },
      }),
    ),
  );
  const { result } = renderHook(() => useAssistant());

  await act(() => result.current.send("Hello"));

  expect(result.current.state.status).toBe("ok");
  expect(result.current.error).toBe("The AI service is busy right now.");
});
