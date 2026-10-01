import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * The assistant as a member meets it. Every /api/ai call is answered in the
 * browser — a fixed list of chats, a fixed conversation with an open plan, a
 * fixed briefing, and "switched off" for anything else — so the suite reads
 * the same whether or not this machine's .env has the assistant enabled, and
 * no test here can spend the club's model quota. Signed-in, so it switches
 * itself off without a dev member, exactly as the signed-in scans in
 * a11y.spec.ts do (docs/accessibility.md).
 */
const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL;
const MEMBER_PASSWORD = process.env.E2E_MEMBER_PASSWORD;

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.skip(
  !MEMBER_EMAIL || !MEMBER_PASSWORD,
  "Set E2E_MEMBER_EMAIL and E2E_MEMBER_PASSWORD (with DEV_PASSWORD_AUTH=1 and a db:dev-member account) to drive the assistant.",
);

const PLAN_CHAT = "0192f1a0-0000-7000-8000-0000000000c1";
const OTHER_CHAT = "0192f1a0-0000-7000-8000-0000000000c2";
const RUN_ID = "0192f1a0-0000-7000-8000-000000000001";

const chat = (id: string, title: string) => ({
  id,
  title,
  seedEventId: null,
  lastMessageAt: "2026-10-01T02:00:00.000Z",
  createdAt: "2026-10-01T01:00:00.000Z",
});

const conversation = {
  chat: chat(PLAN_CHAT, "Hack night plan"),
  messages: [
    {
      id: "0192f1a0-0000-7000-8000-0000000000d1",
      role: "member",
      body: "Plan a hack night",
      createdAt: "2026-10-01T01:00:00.000Z",
      runId: null,
      proposal: null,
      proposalStatus: null,
      applied: null,
    },
    {
      id: "0192f1a0-0000-7000-8000-0000000000d2",
      role: "assistant",
      body: "Here is a plan for Hack Night.",
      createdAt: "2026-10-01T01:00:05.000Z",
      runId: RUN_ID,
      proposal: {
        createEvent: { ref: "$event1", title: "Hack Night", startsAt: "2026-11-20T08:00:00.000Z" },
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
      proposalStatus: "open",
      applied: null,
    },
  ],
};

const briefing = {
  briefing: { summary: "A quiet week before Hack Night.", bullets: ["Book the room"] },
  generatedAt: "2026-10-01T00:30:00.000Z",
};

const switchedOff = {
  status: 503,
  json: { error: { code: "AI_DISABLED", message: "The assistant is not enabled." } },
};

/** Answers the assistant's endpoints. `on: false` is a deployment with it switched off. */
async function stubAssistant(page: Page, { on = true }: { on?: boolean } = {}) {
  await page.route("**/api/ai/**", (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    if (method === "GET" && pathname === "/api/ai/chats") {
      return route.fulfill({
        json: { chats: [chat(PLAN_CHAT, "Hack night plan"), chat(OTHER_CHAT, "What is overdue?")] },
      });
    }
    if (method === "GET" && pathname === `/api/ai/chats/${PLAN_CHAT}/messages`) {
      return route.fulfill({ json: conversation });
    }
    if (on && method === "GET" && pathname === "/api/ai/briefing") {
      return route.fulfill({ json: briefing });
    }
    return route.fulfill(switchedOff);
  });
}

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

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

// Both themes, as in a11y.spec.ts: a dark: class is invisible to a light-mode scan.
for (const theme of ["light", "dark"] as const) {
  test(`lists chats and opens one with its plan as a card (${theme})`, async ({ page }) => {
    await page.goto("/");
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    await stubAssistant(page);

    await page.goto("/ai");
    // main.tsx applies the stored theme on boot; a scan in the wrong one proves nothing.
    if (theme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/u);
    const chats = page.getByRole("navigation", { name: "Chats" });
    await expect(chats.getByRole("link", { name: /What is overdue/u })).toBeVisible();
    await expect(chats.getByRole("link", { name: "New chat" })).toBeVisible();

    await chats.getByRole("link", { name: /Hack night plan/u }).click();

    await expect(page).toHaveURL(new RegExp(`/ai/${PLAN_CHAT}$`, "u"));
    await expect(page.getByText("Here is a plan for Hack Night.")).toBeVisible();
    const footer = page.getByRole("button", { name: /^Create/u });
    await expect(footer).toHaveText("Create 1 event + 2 tasks");

    await page.getByRole("checkbox", { name: "Include Order pizza" }).uncheck();

    await expect(footer).toHaveText("Create 1 event + 1 task");
    // The card is the most complex interactive surface in the app (R13, US-21).
    expect(await axeViolations(page, "main")).toEqual([]);
  });
}

test("shows the briefing on the Overview and pinned in AI Breakdown", async ({ page }) => {
  await stubAssistant(page);

  await page.goto("/");
  const briefingHeading = page.getByRole("heading", { name: "Your Briefing" });
  await expect(briefingHeading).toBeVisible();
  await expect(page.getByText("A quiet week before Hack Night.")).toBeVisible();
  // It leads the page: above the statistics, not tucked into the right rail.
  const statistics = page.getByRole("region", { name: "Overview statistics" });
  const [briefingTop, statisticsTop] = await Promise.all([
    briefingHeading.evaluate((element) => element.getBoundingClientRect().top),
    statistics.evaluate((element) => element.getBoundingClientRect().top),
  ]);
  expect(briefingTop).toBeLessThan(statisticsTop);

  await page.getByRole("link", { name: "Ask the assistant" }).click();

  await expect(page).toHaveURL(/\/ai\/briefing$/u);
  await expect(page.getByRole("link", { name: "Today's briefing" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("textbox", { name: "Ask about this…" })).toBeVisible();
  expect(await axeViolations(page, "main")).toEqual([]);
});

test("shows no assistant chat in Messages", async ({ page }) => {
  await stubAssistant(page);

  await page.goto("/messages");
  await expect(page.getByRole("heading", { name: "Messages" })).toBeVisible();

  // Messages reads the real thread API, which never serves an ai channel — and
  // the page no longer has an assistant entry of its own.
  await expect(page.getByText("MAC Assistant")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /assistant/iu })).toHaveCount(0);
});

test("says the assistant is off when it is, and still lists the chats", async ({ page }) => {
  await stubAssistant(page, { on: false });

  await page.goto("/ai");
  const chats = page.getByRole("navigation", { name: "Chats" });
  await expect(chats.getByRole("link", { name: /Hack night plan/u })).toBeVisible();
  // No briefing to pin on a deployment without an assistant.
  await expect(chats.getByRole("link", { name: "Today's briefing" })).toHaveCount(0);

  await page.getByRole("textbox", { name: "Message the assistant" }).fill("Hello");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("The assistant is switched off")).toBeVisible();
  await expect(chats.getByRole("link", { name: /Hack night plan/u })).toBeVisible();
});
