import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LoadingLine } from "./loading-line";

afterEach(() => vi.useRealTimers());

it("announces its label as a status and turns an ASCII spinner, hidden from assistive tech", () => {
  vi.useFakeTimers();
  render(<LoadingLine label="Loading Members…" />);

  const status = screen.getByRole("status");
  expect(screen.getByText("Loading Members…")).toBeInTheDocument();
  const spinner = status.querySelector("[aria-hidden]")!;
  const first = spinner.textContent;
  act(() => vi.advanceTimersByTime(130));
  expect(spinner.textContent).not.toBe(first);
  expect(["|", "/", "-", "\\"]).toContain(spinner.textContent);
});

it("stands still for a reader who has asked for less motion", () => {
  vi.useFakeTimers();
  const original = window.matchMedia;
  window.matchMedia = (query: string) =>
    ({ ...original(query), matches: query.includes("reduce") }) as MediaQueryList;
  try {
    render(<LoadingLine label="Loading Members…" />);
    const spinner = screen.getByRole("status").querySelector("[aria-hidden]")!;
    const first = spinner.textContent;
    act(() => vi.advanceTimersByTime(500));
    expect(spinner.textContent).toBe(first);
  } finally {
    window.matchMedia = original;
  }
});
