import { expect, test } from "@playwright/test";

test("protected pages redirect to sign in", async ({ page }) => {
  await page.goto("/health");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: /sign in with google/i })).toBeVisible();
});
