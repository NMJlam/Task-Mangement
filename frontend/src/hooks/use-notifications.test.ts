import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useNotificationsSource } from "./use-notifications";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("stamps each landed read, and says so when the feed cannot be reached", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ notifications: [], unreadCount: 0 }),
  }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useNotificationsSource());
  expect(result.current.syncedAt).toBeUndefined();
  await waitFor(() => expect(result.current.syncedAt).toBeInstanceOf(Date));
  expect(result.current.stale).toBe(false);

  fetchMock.mockImplementation(async () => {
    throw new Error("offline");
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(result.current.stale).toBe(true);
});
