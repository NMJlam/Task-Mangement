import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useBriefing } from "./use-briefing";

afterEach(() => vi.unstubAllGlobals());

const respond = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

it("reads today's briefing and exposes its summary and bullets", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    respond(200, {
      briefing: { summary: "A quiet day.", bullets: ["Book the room"] },
      generatedAt: "2026-10-14T22:30:00.000Z",
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useBriefing());

  await waitFor(() =>
    expect(result.current).toMatchObject({
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

  await waitFor(() => expect(result.current.status).toBe("disabled"));
});
