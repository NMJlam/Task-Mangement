/**
 * The Postgres error under a failed query, if there is one. Drizzle wraps the
 * driver's error, so the SQLSTATE and the constraint it names sit somewhere
 * down the `cause` chain.
 */
export function pgError(error: unknown): { code: string; constraint?: string } | undefined {
  let cursor: unknown = error;
  while (typeof cursor === "object" && cursor !== null) {
    if ("code" in cursor && typeof cursor.code === "string") {
      const constraint =
        "constraint" in cursor && typeof cursor.constraint === "string"
          ? cursor.constraint
          : undefined;
      return { code: cursor.code, constraint };
    }
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return undefined;
}
