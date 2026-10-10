import AxeBuilder from "@axe-core/playwright";
import type {
  Message,
  NotificationListResponse,
  MeResponse,
  MemberListResponse,
} from "@ctp/shared";
import { expect, test, type Page } from "@playwright/test";

const email = process.env.E2E_MEMBER_EMAIL;
const password = process.env.E2E_MEMBER_PASSWORD;
const otherEmail = process.env.E2E_OTHER_EMAIL;
const otherPassword = process.env.E2E_OTHER_PASSWORD;
test.skip(
  !email || !password || !otherEmail || !otherPassword,
  "Requires two local dev members; E2E_MEMBER_* and E2E_OTHER_*.",
);

async function signIn(page: Page, other = false) {
  expect(
    (
      await page.request.post("/api/auth/sign-in/email", {
        data: { email: other ? otherEmail : email, password: other ? otherPassword : password },
      })
    ).ok(),
  ).toBe(true);
  const response = await page.request.get("/api/me");
  expect(response.ok()).toBe(true);
  return ((await response.json()) as MeResponse).user;
}
async function group(page: Page, memberIds: string[] = []) {
  const name = "Review messages " + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  const response = await page.request.post("/api/threads", {
    data: { kind: "group", name, memberIds },
  });
  expect(response.status()).toBe(201);
  return { id: ((await response.json()) as { thread: { id: string } }).thread.id, name };
}
async function post(page: Page, id: string, body: string) {
  const response = await page.request.post(`/api/threads/${id}/messages`, { data: { body } });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { message: Message }).message;
}
async function open(page: Page, id: string) {
  await page.goto(`/messages?thread=${id}`);
  const prompt = page.getByRole("dialog", { name: "Change Role" });
  const me = ((await (await page.request.get("/api/me")).json()) as MeResponse).user;
  if (me.role === "president" || me.role === "vice_president") {
    await prompt.getByRole("button", { name: "Cancel" }).click();
  }
  await expect(page.getByRole("log")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}
async function focusRefresh(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

// Real sessions, roster, requests and database throughout. Request interception
// below only delays real responses to exercise races deterministically.
test("real mention delivery, undo/redo and visible timestamps on desktop and mobile", async ({
  page,
  context,
}, info) => {
  const me = await signIn(page);
  const otherPage = await context.browser()!.newPage({ baseURL: "http://localhost:5173" });
  try {
    const other = await signIn(otherPage, true);
    const thread = await group(page, [other.id]);
    await post(otherPage, thread.id, "Venue is confirmed.");
    await post(otherPage, thread.id, "Doors open at six.");
    await open(page, thread.id);
    const log = page.getByRole("log");
    await expect(log.getByRole("article")).toHaveCount(2);
    await expect(log.getByRole("heading", { level: 3 })).toHaveCount(1);
    const continuation = log.getByRole("article").nth(1);
    await expect(continuation.locator("time")).toHaveCSS("opacity", "1");
    const timeBox = await continuation.locator("time").boundingBox();
    const bodyBox = await continuation.locator("p").boundingBox();
    expect(bodyBox!.x - (timeBox!.x + timeBox!.width)).toBeGreaterThanOrEqual(12);
    if (me.role !== "president") await expect(continuation.getByRole("button")).toHaveCount(0);
    const roster = (await (await page.request.get("/api/members")).json()) as {
      members: { id: string; name: string | null; email: string }[];
    };
    const member = roster.members.find((m) => m.id === other.id)!;
    const name = member.name || member.email;
    const box = page.getByLabel(`Message ${thread.name}`);
    const query = member.email;
    await box.pressSequentially("Thanks @" + query);
    await expect(page.getByRole("option", { name, exact: true })).toBeVisible();
    await box.press("Enter");
    await expect(box).toHaveValue(`Thanks @${name} `);
    await expect(log.getByRole("article")).toHaveCount(2);
    await box.press("ControlOrMeta+z");
    await expect(box).toHaveValue("Thanks @" + query);
    await box.press("ControlOrMeta+Shift+z");
    await expect(box).toHaveValue(`Thanks @${name} `);
    await box.pressSequentially("for checking.");
    // Exercise a real native undo of typing, preserving the selected mention.
    await box.evaluate((element) => {
      element.focus();
      document.execCommand("undo");
    });
    await expect(box).toHaveValue(`Thanks @${name} for `);
    await box.press("ControlOrMeta+Shift+z");
    await expect(box).toHaveValue(`Thanks @${name} for checking.`);
    await box.press("Shift+Enter");
    await box.pressSequentially("See you there.");
    const sending = page.waitForRequest(
      (r) => r.method() === "POST" && r.url().endsWith(`/threads/${thread.id}/messages`),
    );
    const sent = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().endsWith(`/threads/${thread.id}/messages`),
    );
    await box.press("Enter");
    const sentMessage = ((await (await sent).json()) as { message: Message }).message;
    expect((await sending).postDataJSON()).toEqual({
      body: `Thanks @[${other.id}] for checking.\nSee you there.`,
    });
    await expect(log.getByText("@" + name, { exact: true })).toBeVisible();
    const feed = (await (
      await otherPage.request.get("/api/notifications")
    ).json()) as NotificationListResponse;
    expect(
      feed.notifications.some((n) => n.kind === "mention" && n.entityId === sentMessage.id),
    ).toBe(true);
    await expect(log).not.toContainText(other.id);
    await page.evaluate(() => window.scrollTo(0, 0));
    const desktopPath = info.outputPath("desktop-chat.png");
    await page.screenshot({ path: desktopPath, fullPage: true });
    await info.attach("desktop-chat", { path: desktopPath, contentType: "image/png" });
    const mobileContext = await context.browser()!.newContext({
      baseURL: "http://localhost:5173",
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      storageState: await context.storageState(),
    });
    const mobile = await mobileContext.newPage();
    try {
      await open(mobile, thread.id);
      await expect(mobile.getByRole("log").getByRole("article")).toHaveCount(3);
      await expect(mobile.getByRole("log").getByRole("article").nth(1).locator("time")).toHaveCSS(
        "opacity",
        "1",
      );
      await expect(mobile.getByRole("button", { name: /^Delete message from/ })).toHaveCSS(
        "opacity",
        "1",
      );
      const mobileRow = mobile.getByRole("log").getByRole("article").nth(1);
      const timeBox = await mobileRow.locator("time").boundingBox();
      const bodyBox = await mobileRow.locator("p").boundingBox();
      expect(bodyBox!.x - (timeBox!.x + timeBox!.width)).toBeGreaterThanOrEqual(12);
      const mobilePath = info.outputPath("mobile-chat.png");
      await mobile.evaluate(() => window.scrollTo(0, 0));
      await mobile.screenshot({ path: mobilePath, fullPage: true });
      const width = await mobile.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
      }));
      expect(width.document).toBeLessThanOrEqual(width.viewport);
      const scan = await new AxeBuilder({ page: mobile })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(scan.violations).toEqual([]);
      await info.attach("mobile-chat", { path: mobilePath, contentType: "image/png" });
    } finally {
      await mobileContext.close();
    }
    await open(otherPage, thread.id);
    await expect(otherPage.getByRole("button", { name: "Delete group" })).toHaveCount(0);
    expect((await otherPage.request.delete(`/api/threads/${thread.id}`)).status()).toBe(403);
    const mine = log.getByRole("article").filter({ hasText: "Thanks" });
    await mine.getByRole("button", { name: /^Delete message from/ }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete message", exact: true })
      .click();
    await expect(log.getByText("Message deleted")).toBeVisible();
    await focusRefresh(otherPage);
    await expect(otherPage.getByRole("log").getByText("Message deleted")).toBeVisible();
    await expect(otherPage.getByRole("log")).not.toContainText("for checking.");
    const remaining = (await (
      await otherPage.request.get("/api/notifications")
    ).json()) as NotificationListResponse;
    expect(remaining.notifications.some((n) => n.entityId === sentMessage.id)).toBe(false);
  } finally {
    await otherPage.close();
  }
});

test("a delayed successful send cannot restore a message already deleted", async ({ page }) => {
  await signIn(page);
  const thread = await group(page);
  await open(page, thread.id);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let committed!: (message: Message) => void;
  const stored = new Promise<Message>((resolve) => {
    committed = resolve;
  });
  await page.route(`**/api/threads/${thread.id}/messages`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    committed(((await response.json()) as { message: Message }).message);
    await held;
    await route.fulfill({ response });
  });
  const box = page.getByLabel(`Message ${thread.name}`);
  await box.fill("Delayed send must stay deleted");
  await box.press("Enter");
  const created = await stored;
  await focusRefresh(page);
  await expect(page.getByRole("log").getByText(created.body)).toBeVisible();
  expect(
    (await page.request.delete(`/api/threads/${thread.id}/messages/${created.id}`)).status(),
  ).toBe(200);
  await focusRefresh(page);
  await expect(page.getByText("Message deleted", { exact: true })).toBeVisible();
  release();
  await expect(box).toHaveValue("");
  await expect(page.getByRole("log")).not.toContainText(created.body);
  await expect(page.getByText("Message deleted", { exact: true })).toBeVisible();
});

test("deletion dialogs close on a same-document conversation change", async ({ page }) => {
  await signIn(page);
  const a = await group(page);
  const b = await group(page);
  await post(page, a.id, "Keep A");
  await post(page, b.id, "Keep B");
  const move = async (id: string) =>
    page.evaluate((id) => {
      history.replaceState(history.state, "", `/messages?thread=${id}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, id);
  await open(page, a.id);
  await page.getByRole("button", { name: /^Delete message from/ }).click();
  await move(b.id);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("log").getByText("Keep B")).toBeVisible();
  await page.getByRole("button", { name: "Delete group" }).click();
  await move(a.id);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("log").getByText("Keep A")).toBeVisible();
  expect((await page.request.get(`/api/threads/${b.id}/messages`)).status()).toBe(200);
});

test("loading history during a refresh preserves every row and its cursor", async ({ page }) => {
  test.setTimeout(120000);
  await signIn(page);
  const thread = await group(page);
  const all: Message[] = [];
  for (let i = 0; i < 150; i++) all.push(await post(page, thread.id, "History " + i));
  await open(page, thread.id);
  const log = page.getByRole("log");
  await expect(log.getByRole("article")).toHaveCount(50);
  await post(page, thread.id, "New during refresh");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const waiting = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let intercepted = false;
  await page.route(`**/api/threads/${thread.id}/messages?before=*`, async (route) => {
    if (intercepted || new URL(route.request().url()).searchParams.get("before") !== all[101]!.id)
      return route.continue();
    intercepted = true;
    const response = await route.fetch();
    reached();
    await held;
    await route.fulfill({ response });
  });
  try {
    await focusRefresh(page);
    await waiting;
    await page.getByRole("button", { name: "Load older" }).click();
    await expect(log.getByRole("article")).toHaveCount(100);
    release();
    await expect(log.getByRole("article")).toHaveCount(101);
    await expect(log.getByText("History 99", { exact: true })).toBeAttached();
    await page.getByRole("button", { name: "Load older" }).click();
    await expect(log.getByRole("article")).toHaveCount(151);
    for (let i = 0; i < 150; i++)
      await expect(log.getByText("History " + i, { exact: true })).toHaveCount(1);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

// No pointer, keyboard, visibility or synthetic focus events reach the receiver
// after opening. This checks real timer delivery with two authenticated sessions.
test("an untouched screen receives messages and an officer can delete their own group", async ({
  page,
  context,
}) => {
  const director = await signIn(page);
  const officerPage = await context.browser()!.newPage({ baseURL: "http://localhost:5173" });
  try {
    const officer = await signIn(officerPage, true);
    expect(officer.role).toBe("officer");
    const thread = await group(officerPage, [director.id]);
    await open(officerPage, thread.id);
    const roster = (await (
      await officerPage.request.get("/api/members")
    ).json()) as MemberListResponse;
    const directorIdentity = roster.members.find((member) => member.id === director.id)!;
    const directorName = directorIdentity.name || directorIdentity.email;
    const composer = officerPage.getByLabel("Message " + thread.name);
    await composer.pressSequentially("Sent to an untouched screen @" + directorIdentity.email);
    await expect(
      officerPage.getByRole("option", { name: directorName, exact: true }),
    ).toBeVisible();
    await composer.press("Enter");
    await expect(composer).toHaveValue("Sent to an untouched screen @" + directorName + " ");
    await open(page, thread.id);
    await expect(page.getByRole("button", { name: "Delete group" })).toHaveCount(
      director.role === "president" ? 1 : 0,
    );
    const received = officerPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/threads/" + thread.id + "/messages"),
    );
    const started = Date.now();
    await composer.press("Enter");
    const incoming = ((await (await received).json()) as { message: Message }).message;
    expect(incoming.body).toBe("Sent to an untouched screen @[" + director.id + "]");
    await expect(page.getByRole("log").getByText("@" + directorName, { exact: true })).toBeVisible({
      timeout: 5_000,
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(
      (
        await officerPage.request.delete("/api/threads/" + thread.id + "/messages/" + incoming.id)
      ).status(),
    ).toBe(200);
    await expect(page.getByRole("log").getByText("Message deleted", { exact: true })).toBeVisible({
      timeout: 5_000,
    });
    await open(officerPage, thread.id);
    await officerPage.getByRole("button", { name: "Delete group", exact: true }).click();
    const confirmation = officerPage.getByRole("dialog", { name: "Delete “" + thread.name + "”?" });
    await confirmation.getByRole("button", { name: "Delete group", exact: true }).click();
    await expect(officerPage.getByRole("navigation", { name: "Conversations" })).not.toContainText(
      thread.name,
    );
    await expect(page.getByRole("heading", { name: thread.name, exact: true })).toHaveCount(0, {
      timeout: 5_000,
    });
    expect((await page.request.get("/api/threads/" + thread.id + "/messages")).status()).toBe(404);
  } finally {
    await officerPage.close();
  }
});

test("private mentions and the group-members list include only participants", async ({
  page,
  context,
}, info) => {
  const me = await signIn(page);
  const otherPage = await context.browser()!.newPage({ baseURL: "http://localhost:5173" });
  try {
    const other = await signIn(otherPage, true);
    const roster = (await (await page.request.get("/api/members")).json()) as MemberListResponse;
    const mine = roster.members.find((member) => member.id === me.id)!;
    const invited = roster.members.find((member) => member.id === other.id)!;
    const outsider = roster.members.find((member) =>
      process.env.E2E_OUTSIDER_EMAIL
        ? member.email === process.env.E2E_OUTSIDER_EMAIL
        : member.id !== me.id && member.id !== other.id,
    )!;
    expect(outsider, "Requires a third club member outside this test group").toBeDefined();
    const thread = await group(page, [other.id]);
    await open(page, thread.id);
    const trigger = page.getByRole("button", { name: "Members (2)", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Group members" });
    for (const member of [mine, invited]) {
      await expect(dialog.getByText(member.name || member.email, { exact: true })).toBeVisible();
      await expect(dialog.getByText(member.email, { exact: true })).toBeVisible();
    }
    await expect(dialog.getByRole("listitem")).toHaveCount(2);
    await expect(dialog.getByText(outsider.name || outsider.email, { exact: true })).toHaveCount(0);
    await expect(dialog.getByText("You", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Group creator", { exact: true })).toBeVisible();
    const desktopPath = info.outputPath("group-members-desktop.png");
    await page.screenshot({ path: desktopPath, fullPage: true });
    await info.attach("group-members-desktop", { path: desktopPath, contentType: "image/png" });
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    const box = page.getByLabel("Message " + thread.name);
    await box.fill("@");
    await expect(page.getByRole("option")).toHaveCount(1);
    await expect(
      page.getByRole("option", { name: invited.name || invited.email, exact: true }),
    ).toBeVisible();
    await box.fill("@" + outsider.email);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    // A copied or stale ID token must also fail through the real API/UI.
    const invalidBody = "@[" + outsider.id + "]";
    await box.fill(invalidBody);
    const refused = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/threads/" + thread.id + "/messages"),
    );
    await box.press("Enter");
    expect((await refused).status()).toBe(422);
    await expect(page.getByRole("alert")).toContainText(
      "Mention only people who belong to this conversation.",
    );
    await expect(box).toHaveValue(invalidBody);
    await expect(page.getByRole("log").getByRole("article")).toHaveCount(0);
    expect(
      (
        (await (await page.request.get("/api/threads/" + thread.id + "/messages")).json()) as {
          messages: Message[];
        }
      ).messages,
    ).toEqual([]);

    const mobileContext = await context.browser()!.newContext({
      baseURL: "http://localhost:5173",
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      storageState: await context.storageState(),
    });
    try {
      const mobile = await mobileContext.newPage();
      await open(mobile, thread.id);
      await mobile.getByRole("button", { name: "Members (2)", exact: true }).click();
      const mobileDialog = mobile.getByRole("dialog", { name: "Group members" });
      await expect(mobileDialog.getByRole("listitem")).toHaveCount(2);
      await expect(mobileDialog.getByText(invited.email, { exact: true })).toBeVisible();
      const width = await mobile.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
      }));
      expect(width.document).toBeLessThanOrEqual(width.viewport);
      expect(
        (
          await new AxeBuilder({ page: mobile })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      const mobilePath = info.outputPath("group-members-mobile.png");
      await mobile.screenshot({ path: mobilePath, fullPage: true });
      await info.attach("group-members-mobile", { path: mobilePath, contentType: "image/png" });
    } finally {
      await mobileContext.close();
    }
  } finally {
    await otherPage.close();
  }
});
