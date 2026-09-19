export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Calendar-day arithmetic, shared by the calendar grid and the event date form.
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

/** Midnight `days` days on. Drops the time of day — see `shiftDays` for the other one. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * Moves an instant by whole local days, KEEPING its time of day. An event moved a
 * day without its start time kept would be a silent edit nobody asked for.
 */
export function shiftDays(date: Date, days: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
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

/**
 * Whole local days from `from` to `to`, which is what a drag measures. Rounding
 * absorbs the hour a DST switch adds or removes.
 */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
}
