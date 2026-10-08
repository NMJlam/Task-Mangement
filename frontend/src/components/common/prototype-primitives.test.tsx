import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./page-header";
import { StatusBadge, statusStyles, toneChip, toneText } from "./status-badge";
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
   * The tint pairs are gone - a status is now coloured text from a THEME TOKEN,
   * and `index.css` defines every token in both themes - so the shape that
   * failed can no longer be written. What can regress is a hand-added Tailwind
   * palette class (`bg-emerald-50`), which reintroduces a per-theme colour that
   * axe cannot see in a light-mode page. That is what this asserts over, for
   * every status, because the failure mode is one entry added later.
   */
  it("colours every status from a theme token, never the Tailwind palette (WCAG AA, R13)", () => {
    const paletteColour =
      /\b(?:emerald|amber|red|green|yellow|orange|rose|indigo|violet|sky|blue|teal|stone|zinc|slate|gray|neutral)-[0-9]/;

    // Guards the guard: a refactor that emptied the vocabulary would otherwise
    // leave this passing over nothing.
    expect(Object.keys(statusStyles)).toHaveLength(15);

    for (const [status, style] of Object.entries(statusStyles)) {
      const classes = [toneText[style.tone], toneChip[style.tone]];
      for (const className of classes) {
        expect(className, `${status} must not name a Tailwind palette colour`).not.toMatch(
          paletteColour,
        );
        expect(className, `${status} must not carry a dark: half`).not.toMatch(/dark:/);
      }
    }
  });
});
