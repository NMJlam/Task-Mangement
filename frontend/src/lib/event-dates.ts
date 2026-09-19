/**
 * The contract for moving an event's dates, shared by the two ViewModels that
 * write it (the event page's `useEvent`, the calendar's `useCalendar`) and the
 * one dialog that reads it. It lives outside both so neither layer owns the
 * other: the dialog is presentational and does not fetch, the hooks do not know
 * about dialogs.
 */
export interface EventDates {
  startsAt: Date;
  endsAt: Date | null;
}

/**
 * The outcome of a save. A refusal carries the sentence to show — the route's
 * per-field message where there is one (see `lib/api-error.ts`).
 */
export type EventDatesSave = { ok: true; warnings: string[] } | { ok: false; message: string };
