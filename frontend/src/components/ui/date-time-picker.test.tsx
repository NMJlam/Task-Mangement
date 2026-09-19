import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateTimePicker } from "./date-time-picker";

/**
 * The grid is pinned to a fixed local day so the assertions can name the cell
 * they click: `defaultMonth` follows `value` (absent here) and therefore today.
 */
const TODAY = new Date(2026, 8, 15, 9, 0, 0);
const PICKED_DAY = "2026-09-21";

/**
 * The day cell by its own `data-day` attribute — the library's stable handle on a
 * date (documented for styling) rather than its locale-dependent accessible name,
 * which would make this test fail on a non-English machine.
 */
function dayButton(isoDate: string) {
  const cell = document.querySelector(`[data-day="${isoDate}"]`);
  if (!cell) throw new Error(`No calendar cell for ${isoDate}`);
  return within(cell as HTMLElement).getByRole("button");
}

describe("DateTimePicker", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(TODAY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses to apply a time with no day, and a day with no time", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onChange = vi.fn();
    render(
      <DateTimePicker
        id="due"
        label="due date"
        timeLabel="Deadline time"
        value={null}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Select due date" }));
    const apply = screen.getByRole("button", { name: "Apply" });
    // Nothing chosen yet: there is no deadline to apply, and inventing midnight
    // would store a time the user never stated.
    expect(apply).toBeDisabled();

    await user.type(screen.getByLabelText("Deadline time"), "14:30");
    // A time on its own is still not a deadline.
    expect(apply).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();

    await user.click(dayButton(PICKED_DAY));
    expect(apply).toBeEnabled();
  });

  it("composes the chosen local day and time into one instant", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onChange = vi.fn();
    render(
      <DateTimePicker
        id="due"
        label="due date"
        timeLabel="Deadline time"
        value={null}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Select due date" }));
    await user.click(dayButton(PICKED_DAY));
    await user.type(screen.getByLabelText("Deadline time"), "14:30");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    // Local wall-clock time, which is what the rest of the app renders and what
    // a `datetime-local` field used to mean.
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 8, 21, 14, 30));
  });

  it("shows the stored deadline, and only offers Clear once there is one", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onChange = vi.fn();
    const { unmount } = render(
      <DateTimePicker
        id="due"
        label="due date"
        timeLabel="Deadline time"
        value={new Date(2026, 8, 21, 14, 30)}
        onChange={onChange}
      />,
    );

    // The trigger carries the chosen value by its time, not just the day.
    expect(screen.getByRole("button", { name: /2026.*2:30/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /2026.*2:30/ }));
    await user.click(screen.getByRole("button", { name: "Clear due date" }));

    expect(onChange).toHaveBeenCalledWith(null);

    unmount();
    // With no value there is nothing to clear, so the action is not offered.
    render(
      <DateTimePicker
        id="due"
        label="due date"
        timeLabel="Deadline time"
        value={null}
        onChange={onChange}
      />,
    );
    expect(screen.queryByRole("button", { name: "Clear due date" })).not.toBeInTheDocument();
  });

  it("cancels without reporting anything, and forgets the abandoned edit", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onChange = vi.fn();
    render(
      <DateTimePicker
        id="due"
        label="due date"
        timeLabel="Deadline time"
        value={new Date(2026, 8, 21, 14, 30)}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /2026.*2:30/ }));
    await user.clear(screen.getByLabelText("Deadline time"));
    await user.type(screen.getByLabelText("Deadline time"), "08:00");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onChange).not.toHaveBeenCalled();

    // Reopening restarts from the stored value rather than the abandoned one.
    await user.click(screen.getByRole("button", { name: /2026.*2:30/ }));
    expect(screen.getByLabelText("Deadline time")).toHaveValue("14:30");
  });

  it("words the control from its label, and hides Clear where the value is required", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onChange = vi.fn();
    render(
      <DateTimePicker
        id="event-start"
        label="start date"
        timeLabel="Start time"
        // An event always has a start, so clearing is not a state the caller takes.
        allowClear={false}
        value={new Date(2026, 8, 21, 14, 30)}
        onChange={onChange}
      />,
    );

    // The caller's own `<Label htmlFor>` names the trigger in the app; here the
    // trigger carries the stored value as its text.
    await user.click(screen.getByRole("button", { name: /2:30/ }));
    expect(screen.getByRole("dialog", { name: "Pick the start date" })).toBeInTheDocument();
    expect(screen.getByLabelText("Start time")).toHaveValue("14:30");
    expect(screen.queryByRole("button", { name: /^clear/i })).not.toBeInTheDocument();
  });
});
