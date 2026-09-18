import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CalendarPage } from "./calendar";

afterEach(() => vi.unstubAllGlobals());

it("loads the agenda once and renders calendar items", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      items: [
        {
          kind: "event",
          id: "018f3a4b-0000-7000-8000-000000000001",
          title: "Welcome Night",
          startsAt: "2026-09-24T08:00:00.000Z",
          endsAt: null,
          status: "planning",
        },
      ],
    }),
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<CalendarPage />);

  await waitFor(() => expect(screen.getByText("Welcome Night")).toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledOnce();
});
