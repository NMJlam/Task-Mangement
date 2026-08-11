import type { Tier } from "@ctp/shared";
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
