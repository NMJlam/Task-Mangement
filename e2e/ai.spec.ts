import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * The assistant as a member meets it, with AI OFF. Every /api/ai call is
 * answered in the browser — "switched off" by default, a fixed plan for the
 * card spec — so the suite reads the same whether or not this machine's .env
 * has the assistant enabled, and no test here can spend the club's model quota.
 * Signed-in, so it switches itself off without a dev member, exactly as the
 * signed-in scans in a11y.spec.ts do (docs/accessibility.md).
 */
const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL;
const MEMBER_PASSWORD = process.env.E2E_MEMBER_PASSWORD;

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.skip(
  !MEMBER_EMAIL || !MEMBER_PASSWORD,
  "Set E2E_MEMBER_EMAIL and E2E_MEMBER_PASSWORD (with DEV_PASSWORD_AUTH=1 and a db:dev-member account) to drive the assistant.",
);

async function signIn(page: Page) {
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: { email: MEMBER_EMAIL, password: MEMBER_PASSWORD },
  });
  expect(response.ok(), "dev password sign-in failed — is DEV_PASSWORD_AUTH=1 set?").toBe(true);
  const me = await page.request.get("/api/me");
  expect(me.ok(), "signed in, but /api/me answered without membership").toBe(true);
}

async function axeViolations(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
  return (await (include ? builder.include(include) : builder).analyze()).violations;
}

async function ask(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Message the assistant" }).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await page.route("**/api/ai/**", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: "AI_DISABLED", message: "The assistant is not enabled." } },
    }),
  );
});

test("says the assistant is off, and keeps the generated-task rail", async ({ page }) => {
  await page.goto("/ai");
  await expect(page.getByRole("heading", { name: "AI Assistant" })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  // The page learns the deployment has no assistant from the 503 it gets back.
  await ask(page, "What's overdue?");

  await expect(page.getByText("The assistant is switched off")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Generated tasks" })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("shows the usual dashboard, with no briefing card while the assistant is off", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Committee Load" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your Briefing" })).toHaveCount(0);
});

// Both themes, as in a11y.spec.ts: a dark: class is invisible to a light-mode scan.
for (const theme of ["light", "dark"] as const) {
  test(`renders a drafted plan as a card the member can trim before confirming (${theme})`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    await page.route("**/api/ai/messages", (route) =>
      route.fulfill({
        json: {
          runId: "0192f1a0-0000-7000-8000-000000000001",
          reply: "Here is a plan for Hack Night.",
          proposal: {
            createEvent: {
              ref: "$event1",
              title: "Hack Night",
              startsAt: "2026-11-20T08:00:00.000Z",
            },
            createTasks: [
              {
                title: "Book the room",
                priority: "high",
                dueAt: null,
                assignees: [],
                eventRef: "$event1",
              },
              {
                title: "Order pizza",
                priority: "medium",
                dueAt: null,
                assignees: [],
                eventRef: "$event1",
              },
            ],
          },
        },
      }),
    );
    await page.goto("/ai");

    await ask(page, "Plan a hack night");

    await expect(page.getByText("Here is a plan for Hack Night.")).toBeVisible();
    const footer = page.getByRole("button", { name: /^Create/u });
    await expect(footer).toHaveText("Create 1 event + 2 tasks");

    await page.getByRole("checkbox", { name: "Include Order pizza" }).uncheck();

    await expect(footer).toHaveText("Create 1 event + 1 task");
    // The card is the most complex interactive surface in the app (R13, US-21).
    expect(await axeViolations(page, "main")).toEqual([]);
  });
}
