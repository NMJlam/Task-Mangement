import { z } from "zod";

/**
 * Task vocabulary. Defined here once (§1.2) and imported by BOTH the frontend
 * board and the Drizzle schema, which generates its SQL CHECK constraints from
 * `.options` — see `backend/src/db/schema/task.ts`. Adding a value here is the
 * only edit needed on the application side; the database follows on the next
 * `db:generate`.
 */
/**
 * `blocked` earns its place: it is the signal that someone is waiting on
 * someone else, which is the failure mode a volunteer committee actually
 * suffers from. Without it a stalled task sits in `in_progress` looking healthy.
 */
export const taskStatusSchema = z.enum(["todo", "in_progress", "blocked", "done"]);

export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);

export type TaskPriority = z.infer<typeof taskPrioritySchema>;
