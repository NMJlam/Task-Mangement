import type { NextFunction, Request, Response } from "express";

/**
 * Resolves the session and attaches the current user to the request.
 * TODO(R2): verify the session cookie, load the user (keyed on Google `sub`),
 * and 401 when absent/expired. Stub passes through for now.
 */
export function authenticate(_req: Request, _res: Response, next: NextFunction): void {
  next();
}
