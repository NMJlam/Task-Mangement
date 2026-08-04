import type { NextFunction, Request, Response } from "express";

/**
 * First link in the chain: request logging.
 * TODO(R11): structured request/response logging + correlation id.
 */
export function log(req: Request, _res: Response, next: NextFunction): void {
  // Minimal breadcrumb for now; replace with structured logging in Increment 1.
  // Log the pathname only — req.originalUrl carries the query string, which can
  // hold tokens/emails. TODO(R11): allowlist-redact query keys in structured logs.
  console.log(`${req.method} ${req.path}`);
  next();
}
