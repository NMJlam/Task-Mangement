import { sql, type SQL } from "drizzle-orm";

/**
 * Turns a zod enum's `.options` into a SQL value list for a CHECK constraint.
 *
 * This is the mechanism behind CLAUDE.md rule 1 for the database: a vocabulary
 * is declared ONCE as a zod enum in `@ctp/shared`, and every CHECK constraint is
 * generated from it. There are no hand-written value lists in the schema, so the
 * database and `shared/` cannot drift — adding a value is a one-line edit in
 * `shared/`, and the next `db:generate` carries it into SQL.
 *
 * Values are single-quoted and internally escaped. They come from zod enums in
 * our own source, never from user input.
 */
export function sqlEnumValues(values: readonly string[]): SQL {
  return sql.join(
    values.map((value) => sql.raw(`'${value.replaceAll("'", "''")}'`)),
    sql`, `,
  );
}

/** `length(trim(col)) > 0` — the non-blank text check used across the schema. */
export function notBlank(column: SQL | unknown): SQL {
  return sql`length(trim(${column})) > 0`;
}
