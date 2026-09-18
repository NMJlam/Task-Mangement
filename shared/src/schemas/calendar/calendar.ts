import { z } from "zod";
import { eventStatusSchema } from "../event/event.js";

/**
 * `GET /api/calendar` query. Two range reads unioned in the service layer,
 * both tier-filtered. `teamId` deliberately excludes standing tasks
 * (`task.team_id` is nullable — standing committee work belongs to no team).
 *
 * Clash detection is out of scope: it has no agreed definition (same-day vs.
 * interval overlap), and `ends_at` is nullable, which leaves an interval
 * undefined for those rows. Revisit with a decision, not an implementation —
 * so there is no `clashes` field anywhere here.
 */
export const calendarQuerySchema = z.object({
  teamId: z.uuid().optional(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  include: z
    .preprocess(
      (value) => {
        if (typeof value !== "string") return value;
        return value
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
      },
      z.array(z.enum(["events", "tasks"])),
    )
    .optional(),
});

export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

const calendarEventItemSchema = z.object({
  kind: z.literal("event"),
  id: z.uuid(),
  title: z.string(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullable(),
  status: eventStatusSchema,
});

const calendarTaskItemSchema = z.object({
  kind: z.literal("task"),
  id: z.uuid(),
  title: z.string(),
  dueAt: z.coerce.date().nullable(),
  eventId: z.uuid().nullable(),
  // Every assignee, not a representative one: the set has no order, so picking
  // "the" assignee would invent a fact the database does not hold.
  assigneeIds: z.array(z.uuid()),
});

/** Discriminated on `kind`, matching the response doc exactly — no `clashes`. */
export const calendarItemSchema = z.discriminatedUnion("kind", [
  calendarEventItemSchema,
  calendarTaskItemSchema,
]);

export type CalendarItem = z.infer<typeof calendarItemSchema>;

export const calendarResponseSchema = z.object({
  items: z.array(calendarItemSchema),
});

export type CalendarResponse = z.infer<typeof calendarResponseSchema>;
