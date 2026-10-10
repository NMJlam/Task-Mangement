import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ThreadSummaryPanel } from "./thread-summary-panel";

const CHANNEL_ID = "018f3a4b-0000-7000-8000-000000000021";

afterEach(() => vi.unstubAllGlobals());

const summary = (first: string) => ({
  ok: true,
  status: 200,
  json: async () => ({
    summary: {
      summary: [first],
      actionItems: [{ text: "Order pizza", suggestedAssigneeName: "Ben" }],
    },
    asOfMessageId: "018f3a4b-0000-7000-8000-000000000022",
    sourceFingerprint: "fp-1",
  }),
});

it("summarises on demand and shows bullets and action items", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(summary("Room booked.")));
  const user = userEvent.setup({ delay: null });
  render(<ThreadSummaryPanel channelId={CHANNEL_ID} />);

  await user.click(screen.getByRole("button", { name: "Summarise thread" }));

  expect(await screen.findByText("Room booked.")).toBeInTheDocument();
  expect(screen.getByText("Order pizza")).toBeInTheDocument();
  expect(screen.getByText(/Ben/u)).toBeInTheDocument();
});

it("re-runs once a summary is showing", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(summary("First take."))
    .mockResolvedValueOnce(summary("Second take."));
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup({ delay: null });
  render(<ThreadSummaryPanel channelId={CHANNEL_ID} />);
  await user.click(screen.getByRole("button", { name: "Summarise thread" }));
  await screen.findByText("First take.");

  await user.click(screen.getByRole("button", { name: "Summarise again" }));

  expect(await screen.findByText("Second take.")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
