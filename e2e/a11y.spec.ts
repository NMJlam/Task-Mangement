import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// R14 harness: an axe scan on the health page. Building this now means the
// Increment-4 accessibility audit is a matter of adding pages, not tooling.
test("health page has no axe violations", async ({ page }) => {
  await page.goto("/health");
  await page.getByRole("heading", { name: /club task platform/i }).waitFor();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
