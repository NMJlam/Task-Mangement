import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("login page has no axe violations", async ({ page }) => {
  await page.goto("/health");
  await page.getByRole("button", { name: /sign in with google/i }).waitFor();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
