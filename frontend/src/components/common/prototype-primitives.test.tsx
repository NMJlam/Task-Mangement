import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./page-header";
import { StatusBadge, statusStyles } from "./status-badge";
import { UserAvatar } from "./user-avatar";

describe("prototype primitives", () => {
  it("renders page context and readable status labels", () => {
    render(
      <>
        <PageHeader title="Events" description="Plan club events" />
        <StatusBadge status="in_progress" />
        <UserAvatar name="Jordan Lee" />
      </>,
    );

    expect(screen.getByRole("heading", { name: "Events" })).toBeInTheDocument();
    expect(screen.getByText("Plan club events")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("JL")).toBeInTheDocument();
  });

  /**
   * The regression this locks out is a real one, not a hypothetical: every
   * tinted badge shipped with `dark:bg-*-950` and no `dark:text-*`, leaving
   * `-700`/`-800` text on a near-black tint at 2.1–2.8:1 against AA's 4.5:1.
   *
   * Asserted over the whole map rather than a sample, because the failure mode
   * is one entry being added later without its dark half — and the axe e2e scan
   * cannot catch it, since a `dark:` class is inert in a light-mode page.
   */
  it("pairs every dark background tint with a dark foreground (WCAG AA, R13)", () => {
    const tinted = Object.entries(statusStyles).filter(([, style]) =>
      style.className.includes("dark:bg-"),
    );
    // Guards the guard: a refactor that renamed the tint classes would otherwise
    // leave this test passing over an empty list.
    expect(tinted.length).toBe(10);

    for (const [status, style] of tinted) {
      expect(style.className, `${status} has a dark background with no dark text colour`).toMatch(
        /dark:text-/,
      );
    }
  });
});
