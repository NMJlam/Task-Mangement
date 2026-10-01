import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useBriefing } from "./use-briefing";

afterEach(() => vi.unstubAllGlobals());

const respond = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const today = respond(200, {
  briefing: { summary: "A quiet day.", bullets: ["Book the room"] },
  generatedAt: "2026-10-14T22:30:00.000Z",
});

it("reads today's briefing and exposes its summary and bullets", async () => {
  const fetchMock = vi.fn().mockResolvedValue(today);
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useBriefing());

  await waitFor(() =>
    expect(result.current.state).toMatchObject({
      status: "ok",
      briefing: { summary: "A quiet day.", bullets: ["Book the room"] },
    }),
  );
  expect(fetchMock).toHaveBeenCalledWith("/api/ai/briefing", expect.anything());
});

it("reports a 503 as the assistant being off", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(respond(503, { error: { code: "AI_DISABLED" } })),
  );

  const { result } = renderHook(() => useBriefing());

  await waitFor(() => expect(result.current.state.status).toBe("disabled"));
});

it("treats a busy AI service as a failure, not as the assistant being off", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(respond(503, { error: { code: "AI_UNAVAILABLE", message: "Busy." } })),
  );

  const { result } = renderHook(() => useBriefing());

  await waitFor(() => expect(result.current.state.status).toBe("error"));
});

it("loads again on retry after a failure, showing that it is trying", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(respond(500, {})).mockResolvedValueOnce(today);
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useBriefing());
  await waitFor(() => expect(result.current.state.status).toBe("error"));

  act(() => result.current.retry());

  expect(result.current.state.status).toBe("loading");
  await waitFor(() => expect(result.current.state.status).toBe("ok"));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
