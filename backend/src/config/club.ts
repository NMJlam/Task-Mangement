import "./load-env.js";

/**
 * `daysUntil` on the event progress endpoint is computed against this, not
 * UTC — `event.starts_at` is `timestamptz`, and a UTC day boundary is off by
 * one for an evening event (see the events+calendar plan, watch-out 8).
 */
export const CLUB_TIMEZONE = process.env.CLUB_TIMEZONE || "Australia/Melbourne";
