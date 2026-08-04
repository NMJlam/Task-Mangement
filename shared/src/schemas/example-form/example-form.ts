import { z } from "zod";

/**
 * Reference schema for the stub form on the frontend.
 *
 * It exists to prove the shared-validation story end to end (§4.4): the SAME
 * schema drives the react-hook-form zodResolver in the browser AND the
 * `validate` middleware on the server. When you build a real feature, define
 * its schema here the same way and import it on both sides — do not redeclare
 * the shape in the component or the route.
 */
export const exampleFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(80),
  email: z.email("Enter a valid email address"),
});

export type ExampleFormValues = z.infer<typeof exampleFormSchema>;
