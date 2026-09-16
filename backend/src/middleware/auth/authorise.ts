import { can, type Capability, type Tier } from "@ctp/shared";
import type { NextFunction, Request, Response } from "express";

function forbidden(res: Response): void {
  res.status(403).json({ error: { code: "FORBIDDEN", message: "You do not have access." } });
}

export function authorise(minTier: Tier) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || req.user.tier < minTier) return forbidden(res);
    next();
  };
}

/**
 * Sibling to `authorise(minTier)` for the rules a tier cannot express: tier 2
 * also admits the VP, treasurer and secretary, so "president-only" (e.g.
 * `event:cancel`) needs the capability map, not a tier threshold.
 */
export function authoriseCapability(capability: Capability) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !can(req.user.role, capability)) return forbidden(res);
    next();
  };
}
