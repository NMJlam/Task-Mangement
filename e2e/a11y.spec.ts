import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * WCAG 2.1 AA scans. The login page needs no fixture; the signed-in pages need a
 * session, which this file obtains the same way a developer does — the dev
 * password sign-in, then `npm run db:dev-member` for the membership. Both halves
 * are environment-provided, so the scans switch themselves off rather than fail
 * on a machine (or a CI job) that has no dev member; see docs/accessibility.md.
 */
const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL;
const MEMBER_PASSWORD = process.env.E2E_MEMBER_PASSWORD;

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return results.violations;
}

/** Signs the context in and leaves the session cookie in its jar. */
async function signIn(page: Page) {
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: { email: MEMBER_EMAIL, password: MEMBER_PASSWORD },
  });
  expect(response.ok(), "dev password sign-in failed — is DEV_PASSWORD_AUTH=1 set?").toBe(true);
  // Proves the session carries club membership, which every scanned route
  // requires: without it the app redirects and the scan would pass on the login
  // page while claiming to have covered the dashboard.
  const me = await page.request.get("/api/me");
  expect(me.ok(), "signed in, but /api/me answered without membership").toBe(true);
}

test("login page has no axe violations", async ({ page }) => {
  await page.goto("/health");
  await page.getByRole("button", { name: /sign in with google/i }).waitFor();

  expect(await axeViolations(page)).toEqual([]);
});

test.describe("signed-in pages", () => {
  test.skip(
    !MEMBER_EMAIL || !MEMBER_PASSWORD,
    "Set E2E_MEMBER_EMAIL and E2E_MEMBER_PASSWORD (with DEV_PASSWORD_AUTH=1 and a db:dev-member account) to scan the signed-in pages.",
  );

  for (const [name, path] of [
    ["overview", "/"],
    ["events", "/events"],
    ["tasks", "/tasks"],
    ["calendar", "/calendar"],
  ] as const) {
    test(`${name} has no axe violations`, async ({ page }) => {
      await signIn(page);
      await page.goto(path);
      // The scans are of loaded pages: a route still on its skeleton has nothing
      // to check, and axe would pass a spinner.
      await expect(page.getByRole("main")).toBeVisible();

      expect(await axeViolations(page)).toEqual([]);
    });
  }

  test("a seeded event's page has no axe violations", async ({ page }) => {
    await signIn(page);
    // Discovered, never hardcoded: the id belongs to the seeded database, not to
    // the repository.
    const response = await page.request.get("/api/events?limit=1");
    const { items } = (await response.json()) as { items: { id: string }[] };
    test.skip(items.length === 0, "No seeded events to open.");

    await page.goto(`/events/${items[0]!.id}`);
    await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();

    expect(await axeViolations(page)).toEqual([]);
  });
});
