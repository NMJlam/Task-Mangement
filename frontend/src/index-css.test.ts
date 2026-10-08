import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Read from disk: Vitest serves CSS imports, `?raw` included, as an empty string.
const css = readFileSync(path.join(import.meta.dirname, "index.css"), "utf8");

/** The body of the first `@media (forced-colors: active)` block. */
function forcedColorsBlock(): string {
  const start = css.indexOf("@media (forced-colors: active)");
  expect(start, "index.css has no forced-colors block").toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("\n}\n", start));
}

/**
 * Rules that live only in `index.css`, where no component test can see them
 * take effect: jsdom applies no stylesheet. Each pins one decision the review
 * of the terminal UI measured in a real browser.
 */
describe("index.css", () => {
  /**
   * The status line is pinned over the bottom 1.75rem (`h-7`) of the viewport.
   * A control the browser scrolls "nearest" into view landed under it, focus
   * outline and all — 11 of 60 links on a long page in the review's repro.
   */
  it("keeps focus scrolled clear of the status line", () => {
    const rule = /html\s*\{[^}]*scroll-padding-bottom:\s*([^;]+);/.exec(css);
    expect(rule, "no scroll-padding-bottom on html").not.toBeNull();
    expect(rule![1]).toContain("1.75rem");
  });

  /**
   * Windows contrast themes force every background to Canvas and drop
   * gradients, which blanked every meter (an over-budget one included) and
   * erased each panel's top rule while its sides, being borders, stayed.
   */
  it("keeps meters and panel top rules drawn under forced colours", () => {
    const block = forcedColorsBlock();
    for (const selector of [".meter-run", ".panel-line"]) expect(block).toContain(selector);
    expect(block).toContain("forced-color-adjust: none");
    expect(block).toContain("CanvasText");
  });
});
