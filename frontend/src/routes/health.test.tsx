import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HealthPage } from "./health";

describe("HealthPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ ok: true, commit: "abc1234" }) }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the heading and the shared-validation form", async () => {
    render(<HealthPage />);
    expect(screen.getByRole("heading", { name: /club task platform/i })).toBeInTheDocument();
    // Let the useHealth effect resolve so the render is settled (no act warning).
    await waitFor(() => expect(screen.getByText(/backend ok/i)).toBeInTheDocument());

    expect(
      await flushUntil(() => screen.queryByRole("button", { name: /submit/i })),
    ).toBeInTheDocument();
  });
});

/**
 * The form is lazy-loaded, and `findBy*` cannot see it: a Suspense resource that
 * resolves inside waitFor's act environment never flushes there, so findBy waits
 * out any timeout even once the chunk has loaded. Advancing real time inside
 * act() is what lets React commit the resolved lazy component.
 */
async function flushUntil<T>(query: () => T | null, attempts = 60): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const found = query();
    if (found) return found;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }
  const found = query();
  if (!found) throw new Error("Lazy component never resolved");
  return found;
}
