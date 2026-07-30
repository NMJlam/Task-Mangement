import type { ApiError } from "@ctp/shared";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

type Part = "body" | "query" | "params";

/**
 * Validates a request part against a zod schema from `@ctp/shared` and responds
 * 422 with the shared {@link ApiError} shape on failure. This is real (not a
 * stub) because the shared-validation story (§4.4) is what the scaffold proves.
 * The schema always comes from `shared/` — never redeclared here.
 *
 * On success the parsed (trimmed, typed) value is exposed on
 * `res.locals.validated` for the handler to consume.
 */
export function validate(schema: z.ZodType, part: Part = "body") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      const fields: Record<string, string[]> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join(".") || "_";
        (fields[key] ??= []).push(issue.message);
      }
      const body: ApiError = {
        error: { code: "VALIDATION_ERROR", message: "Request validation failed", fields },
      };
      res.status(422).json(body);
      return;
    }
    res.locals.validated = result.data;
    next();
  };
}
