import { sql, type SQL } from "drizzle-orm";

/**
 * The UUID shape `z.uuid()` enforces, as a database CHECK.
 *
 * WHY THIS EXISTS. Postgres's `uuid` type accepts ANY 8-4-4-4-12 hex string —
 * it does not constrain the version or variant nibbles. Zod's `z.uuid()` does,
 * and `shared/` validates every stored id with it. So a value written by
 * anything other than `newId()` (v7) or the demo seed's `demoId()` (v5) is
 * storable yet unparseable, and because the frontend parses a whole list in one
 * zod call, ONE such row makes `/api/tasks` and `/api/notifications` fail for
 * every reader — the page dies with a message that blames the network.
 *
 * The fix is to make the database enforce the same domain the schema assumes,
 * so a lax writer fails at INSERT time, loudly, instead of leaving a landmine
 * that breaks a read path months later.
 *
 * The pattern is zod's own, copied so the two cannot drift: version `[1-8]`,
 * variant `[89ab]`, case-insensitive hex, plus the two literals zod also
 * accepts (nil and max). `IS NULL OR` keeps nullable FK columns legal — a CHECK
 * is violated only by FALSE, and NULL compares to unknown, not false.
 */
const UUID_SHAPE =
  "^(00000000-0000-0000-0000-000000000000" +
  "|ffffffff-ffff-ffff-ffff-ffffffffffff" +
  "|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$";

/**
 * Inlined as SQL text, not bound as a parameter: a CHECK expression is stored
 * by the server and cannot contain placeholders. The pattern is a module-level
 * literal with no single quotes in it, so there is nothing to escape.
 */
const UUID_SHAPE_SQL = sql.raw(`'${UUID_SHAPE}'`);

/**
 * One CHECK covering every uuid column of a table. Pass them all: a table-level
 * constraint keeps the schema readable where a column-level one would add six
 * near-identical lines to `message`.
 */
export function uuidShape(...columns: readonly (SQL | unknown)[]): SQL {
  return sql.join(
    columns.map((column) => sql`(${column} IS NULL OR ${column}::text ~ ${UUID_SHAPE_SQL})`),
    sql` AND `,
  );
}
