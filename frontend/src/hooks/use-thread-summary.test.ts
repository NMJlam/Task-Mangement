import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
      sourceFingerprint: "fp-1",
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

it("reports a busy AI service as an error the member can retry", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(respond(503, { error: { code: "AI_UNAVAILABLE", message: "Busy." } })),
  );
  const { result } = renderHook(() => useThreadSummary(CHANNEL_ID));

  await act(() => result.current.summarise());

  expect(result.current.state).toEqual({ status: "error", message: "Busy." });
});

describe("a summary on screen", () => {
  /** Answers the summary, then every validity check with `current`. */
  function stub(current: () => boolean) {
    const fetchMock = vi.fn(async (input: string) =>
      input.includes("/summary/validity")
        ? respond(200, { current: current() })
        : respond(200, {
            summary: { summary: ["Room booked."], actionItems: [] },
            asOfMessageId: MESSAGE_ID,
            sourceFingerprint: "fp-1",
          }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("is taken down when a message it was written from is deleted here", async () => {
    const fetchMock = stub(() => false);
    const { result, rerender } = renderHook(
      ({ version }) => useThreadSummary(CHANNEL_ID, version),
      { initialProps: { version: 0 } },
    );
    await act(() => result.current.summarise());
    expect(result.current.state.status).toBe("ok");

    rerender({ version: 1 });

    await waitFor(() => expect(result.current.state.status).toBe("stale"));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/ai/threads/${CHANNEL_ID}/summary/validity?asOf=${MESSAGE_ID}&fingerprint=fp-1`,
      expect.anything(),
    );
  });

  it("is checked again on return to the tab, and stays while it still stands", async () => {
    let stands = true;
    const fetchMock = stub(() => stands);
    const { result } = renderHook(() => useThreadSummary(CHANNEL_ID));
    await act(() => result.current.summarise());

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url.includes("/validity"))).toBe(true),
    );
    expect(result.current.state.status).toBe("ok");

    // Deleted elsewhere: the next check takes it down.
    stands = false;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(result.current.state.status).toBe("stale"));
  });

  it("is never checked before there is one", async () => {
    const fetchMock = stub(() => false);
    renderHook(() => useThreadSummary(CHANNEL_ID, 3));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
