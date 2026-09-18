// Barrel for the Drizzle schema. drizzle.config.ts and the client factories
// import from here, so every table is registered in one place.
//
// EVERY table must be exported here. drizzle-kit reads the schema DIRECTORY, so
// it would still see a file that is missing from this barrel — but nodeDb() and
// httpDb() build their query builder from THIS file, so an unexported table
// gets migrated yet stays untypeable. Four tables were in exactly that state
// before the reset (teams, team_members, tasks, events).
//
// The same fact has a second consequence: this directory holds TABLE
// DEFINITIONS ONLY. drizzle-kit imports every file in here, so a test file
// (importing vitest) or any other non-schema module breaks `db:migrate` at the
// generate step. Colocated `*.integration.test.ts` files live one level up, in
// src/db/.

export * from "./auth.js";
export * from "./sql-enum.js";

// Identity
export * from "./app-user.js";
export * from "./team.js";
export * from "./team-member.js";
export * from "./invite.js";

// Work
export * from "./event.js";
export * from "./workstream.js";
export * from "./task.js";
export * from "./task-assignee.js";

// Communication
export * from "./channel.js";
export * from "./chan-member.js";
export * from "./ai-run.js";
export * from "./message.js";

// Money
export * from "./expense.js";
export * from "./settings.js";

// Notifications and audit
export * from "./notification.js";
export * from "./audit-log.js";
