import { exampleFormSchema } from "@ctp/shared";
import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { authorise } from "../middleware/authorise.js";
import { validate } from "../middleware/validate.js";

export const exampleRouter = Router();

/**
 * Reference route showing the full chain shape for a mutating endpoint:
 *   authenticate → authorise → validate(schemaFromShared) → handler
 * `log` is applied globally in app.ts, so it is not repeated here.
 *
 * The schema is imported from `@ctp/shared` and is the SAME one the stub form
 * uses on the frontend — copy this pattern for real endpoints. TODO(Rn).
 */
exampleRouter.post(
  "/example",
  authenticate,
  authorise,
  validate(exampleFormSchema, "body"),
  (_req, res) => {
    res.status(200).json({ ok: true, received: res.locals.validated });
  },
);
