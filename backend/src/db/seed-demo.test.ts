import { describe, expect, it } from "vitest";
import { demoInvitees } from "./seed-demo.js";

describe("demoInvitees", () => {
  it("normalizes and deduplicates emails with founder precedence", () => {
    expect(
      demoInvitees(
        " Nathan.Lam.RT@gmail.com ",
        "director@example.com, NATHAN.LAM.RT@GMAIL.COM, director@example.com ",
      ),
    ).toEqual([
      { email: "nathan.lam.rt@gmail.com", role: "president" },
      { email: "director@example.com", role: "director" },
    ]);
  });

  it("rejects missing or invalid configured emails", () => {
    expect(() => demoInvitees(undefined, undefined)).toThrow("FOUNDER_EMAIL");
    expect(() => demoInvitees("founder@example.com", "not-an-email")).toThrow("not-an-email");
  });
});
