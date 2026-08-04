import type { NextFunction, Request, Response } from "express";

/**
 * First link in the chain: request logging.
 * TODO(R11): structured request/response logging + correlation id.
 */
export function log(req: Request, _res: Response, next: NextFunction): void {
  // Minimal breadcrumb for now; replace with structured logging in Increment 1.
  console.log(`${req.method} ${req.originalUrl}`);
  next();
}
