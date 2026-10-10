import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Messaging as a member meets it, against the real API and database: a run of
 * messages under one header, a participant-only mention picker, and deleting
 * a message and a group from the keyboard.
 *
 * Signed-in, so it switches itself off without a dev member, exactly as the
 * signed-in scans in a11y.spec.ts do (docs/accessibility.md). Every creator
 * may delete their own group. Real two-member mention delivery is exercised
 * in messages-review.spec.ts.
 */
const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL;
const MEMBER_PASSWORD = process.env.E2E_MEMBER_PASSWORD;

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.skip(
  !MEMBER_EMAIL || !MEMBER_PASSWORD,
  "Set E2E_MEMBER_EMAIL and E2E_MEMBER_PASSWORD (with DEV_PASSWORD_AUTH=1 and a db:dev-member account) to drive Messages.",
);

async function signIn(page: Page): Promise<{ id: string; role: string }> {
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: { email: MEMBER_EMAIL, password: MEMBER_PASSWORD },
  });
  expect(response.ok(), "dev password sign-in failed — is DEV_PASSWORD_AUTH=1 set?").toBe(true);
  const me = await page.request.get("/api/me");
  expect(me.ok(), "signed in, but /api/me answered without membership").toBe(true);
  return ((await me.json()) as { user: { id: string; role: string } }).user;
}

/** A fresh group with only the signed-in member in it, opened from the session. */
async function openGroup(page: Page): Promise<{ id: string; name: string }> {
  const name = `e2e-messages-${Date.now()}`;
  const response = await page.request.post("/api/threads", {
    data: { kind: "group", name, memberIds: [] },
  });
  expect(response.status()).toBe(201);
  return { id: ((await response.json()) as { thread: { id: string } }).thread.id, name };
}

/**
 * A president or vice president is asked, on every page, whether to hand back
 * `member:role-change` (require-auth.tsx). That is not what these tests are
 * about, so the prompt is dismissed when it appears.
 */
async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("main")).toBeVisible();
  const role = ((await (await page.request.get("/api/me")).json()) as { user: { role: string } })
    .user.role;
  if (role === "president" || role === "vice_president") {
    const prompt = page.getByRole("dialog", { name: "Change Role" });
    await prompt.getByRole("button", { name: "Cancel" }).click();
    await expect(prompt).toBeHidden();
  }
}

test("groups a run, excludes nonparticipants, and deletes a message and the group", async ({
  page,
}) => {
  await signIn(page);
  const group = await openGroup(page);
  await open(page, `/messages?thread=${group.id}`);

  const box = page.getByLabel(`Message ${group.name}`);
  const log = page.getByRole("log");
  // Each send lands in the log, and empties the box, before the next is
  // written: an Enter while one is still sending is held back on purpose.
  for (const body of ["First thing", "Second thing"]) {
    await box.fill(body);
    await box.press("Enter");
    await expect(log.getByText(body)).toBeVisible();
    await expect(box).toHaveValue("");
  }

  // Two messages, one header: the second continues the first's run.
  await expect(log.getByRole("article")).toHaveCount(2);
  await expect(log.getByRole("heading", { level: 3 })).toHaveCount(1);

  // A solo group has no other participants to mention.
  await box.fill("@");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await box.fill("");

  // Delete the first message from the keyboard: Cancel takes focus, so it
  // takes a deliberate Tab to reach the button that deletes.
  const first = log.getByRole("article").filter({ hasText: "First thing" });
  await first.getByRole("button", { name: /^Delete message from / }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Delete this message for everyone?" });
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  const scan = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(scan.violations).toEqual([]);
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Delete message" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(log.getByText("Message deleted")).toBeVisible();
  await expect(log.getByText("First thing")).toHaveCount(0);

  await page.getByRole("button", { name: "Delete group" }).click();
  const confirm = page.getByRole("dialog", { name: `Delete “${group.name}”?` });
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation", { name: "Conversations" })).not.toContainText(
    group.name,
  );
  expect((await page.request.get(`/api/threads/${group.id}/messages`)).status()).toBe(404);
});

test("the Messages page with a run of messages passes an axe scan", async ({ page }) => {
  await signIn(page);
  const group = await openGroup(page);
  for (const body of ["One", "Two", "Three"]) {
    const response = await page.request.post(`/api/threads/${group.id}/messages`, {
      data: { body },
    });
    expect(response.status()).toBe(201);
  }
  await open(page, `/messages?thread=${group.id}`);
  await expect(page.getByText("Three")).toBeVisible();

  const scan = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(scan.violations).toEqual([]);
});
