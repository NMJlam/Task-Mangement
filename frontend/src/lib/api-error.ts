import { apiErrorSchema } from "@ctp/shared";

/**
 * The message to put in front of a user for a failed response body.
 *
 * A `422` from `validate(schema)` carries per-field issues, and those are the
 * ones worth showing — "endsAt must not precede startsAt" says what to fix,
 * where the summary ("Request validation failed") says nothing. Field order is
 * the schema's, which is the order the form presents them in. Everything else
 * (403, 404, 500) has only the summary. `undefined` means the body was not a
 * shared `ApiError` at all — an HTML error page, a proxy timeout.
 */
export function apiErrorMessage(body: unknown): string | undefined {
  const parsed = apiErrorSchema.safeParse(body);
  if (!parsed.success) return undefined;
  const { fields, message } = parsed.data.error;
  const firstField = fields ? Object.values(fields)[0]?.[0] : undefined;
  return firstField ?? message;
}
