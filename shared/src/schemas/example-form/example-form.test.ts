import { describe, expect, it } from "vitest";
import { exampleFormSchema } from "./example-form.js";

describe("exampleFormSchema", () => {
  it("accepts a valid payload", () => {
    const result = exampleFormSchema.safeParse({ name: "Ada", email: "ada@example.com" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty name and a bad email", () => {
    const result = exampleFormSchema.safeParse({ name: "", email: "nope" });
    expect(result.success).toBe(false);
  });
});
