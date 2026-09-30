import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useThreadSummary } from "./use-thread-summary";

const CHANNEL_ID = "018f3a4b-0000-7000-8000-000000000021";
const MESSAGE_ID = "018f3a4b-0000-7000-8000-000000000022";

afterEach(() => vi.unstubAllGlobals());

const respond = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

it("stays idle until asked, then summarises that thread", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    respond(200, {
      summary: { summary: ["Room booked."], actionItems: [] },
      asOfMessageId: MESSAGE_ID,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useThreadSummary(CHANNEL_ID));
  expect(result.current.state.status).toBe("idle");
  expect(fetchMock).not.toHaveBeenCalled();

  await act(() => result.current.summarise());

  expect(fetchMock).toHaveBeenCalledWith(
    `/api/ai/threads/${CHANNEL_ID}/summary`,
    expect.objectContaining({ method: "POST" }),
  );
  expect(result.current.state).toMatchObject({
    status: "ok",
    summary: { summary: ["Room booked."] },
  });
});

it("reports a 503 as the assistant being off", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(respond(503, { error: { code: "AI_DISABLED" } })),
  );
  const { result } = renderHook(() => useThreadSummary(CHANNEL_ID));

  await act(() => result.current.summarise());

  expect(result.current.state.status).toBe("disabled");
});
