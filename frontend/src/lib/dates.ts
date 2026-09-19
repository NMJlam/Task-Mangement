/**
 * Calendar-day arithmetic for the calendar grid.
 *
 * Every boundary here is built from CALENDAR components, never by adding
 * milliseconds: a "day" is not always 24 hours, so `+ 86_400_000` drifts across a
 * DST switch and a queried range silently drops or repeats an hour. The day
 * overflow in the constructor (`new Date(y, m, d + 1)`) is what keeps the
 * arithmetic correct and the shape plain.
 */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Midnight `days` days on. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** The last millisecond of a span of `days` days starting at `start`. */
export function lastInstant(start: Date, days: number): Date {
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + days, 0, 0, 0, -1);
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
