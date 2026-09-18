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
    // Warm the lazy chunk before rendering. A Suspense resource that resolves
    // inside waitFor's act environment does not flush there, so findBy* waits out
    // its timeout even after the chunk loads; pre-importing makes React.lazy
    // resolve on the first act tick instead of racing a Vite transform.
    await import("@/components/common/example-form");

    render(<HealthPage />);
    expect(screen.getByRole("heading", { name: /club task platform/i })).toBeInTheDocument();
    // Let the useHealth effect resolve so the render is settled (no act warning).
    await waitFor(() => expect(screen.getByText(/backend ok/i)).toBeInTheDocument());
    await act(async () => {});
    expect(screen.getByRole("button", { name: /submit/i })).toBeInTheDocument();
  });
});
