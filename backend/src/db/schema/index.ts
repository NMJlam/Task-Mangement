// Barrel for the Drizzle schema. drizzle.config.ts and the client factories
// import from here, so every table is registered in one place.

export * from "./app-user.js";
export * from "./invite.js";
export * from "./audit-log.js";
// R7: the task endpoints read/write `tasks`, and validate `team_id` against
// `teams` before insert so an FK violation surfaces as a 422, not a 500.
export * from "./teams.js";
export * from "./tasks.js";
