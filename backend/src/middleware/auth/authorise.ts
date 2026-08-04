import type { NextFunction, Request, Response } from "express";

/**
 * Role/ownership checks, run after authenticate.
 * TODO(R3): enforce role- and team-scoped permissions; 403 on failure.
 * Stub passes through for now.
 */
export function authorise(_req: Request, _res: Response, next: NextFunction): void {
  next();
}
