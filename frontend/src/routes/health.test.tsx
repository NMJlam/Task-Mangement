import { render, screen, waitFor } from "@testing-library/react";
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
    expect(await screen.findByRole("button", { name: /submit/i })).toBeInTheDocument();
    // Let the useHealth effect resolve so the render is settled (no act warning).
    await waitFor(() => expect(screen.getByText(/backend ok/i)).toBeInTheDocument());
  });
});
