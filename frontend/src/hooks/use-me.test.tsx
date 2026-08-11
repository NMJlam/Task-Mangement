import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMe } from "./use-me";

afterEach(() => vi.unstubAllGlobals());

it("identifies a missing membership response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: { code: "NO_MEMBERSHIP", message: "Club membership required." },
      }),
    }),
  );

  const { result } = renderHook(() => useMe());

  await waitFor(() => expect(result.current.status).toBe("no_membership"));
});

it("keeps other failures distinct from missing membership", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { code: "SERVER_ERROR", message: "Failed." } }),
    }),
  );

  const { result } = renderHook(() => useMe());

  await waitFor(() => expect(result.current.status).toBe("error"));
});
