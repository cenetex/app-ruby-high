import { expect, test } from "@playwright/test";
import { stubPrivyBundle, openViewer, dismissAnnouncements } from "./helpers.js";

const VIEWER = "/api/apps/ruby-high/viewer";

test("13+ confirmation opens the game with only the usual session cookie", async ({ page, context }) => {
  await stubPrivyBundle(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(VIEWER);
  await expect(page.getByRole("heading", { name: "Confirm you are 13+?" })).toBeVisible();
  await expect(page.locator('input[type="number"], input[type="date"], script')).toHaveCount(0);
  expect(await context.cookies()).toEqual([]);
  expect(requests).toHaveLength(1);
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
  await page.getByRole("button", { name: "Yes, continue", exact: true }).click();
  await expect(page.locator("#shell")).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.map((cookie) => cookie.name)).toEqual(["rh_session"]);
  expect(cookies[0].httpOnly).toBe(true);
  expect(await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((key) => /age|birth|confirm13/i.test(key)))).toEqual([]);
  await page.reload();
  await expect(page.locator("#shell")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Confirm you are 13+?" })).toHaveCount(0);
});

test("Leave returns to the landing page with an empty cookie jar", async ({ page, context }) => {
  await page.goto(VIEWER);
  await page.getByRole("link", { name: "Leave", exact: true }).click();
  await expect(page).toHaveURL(`${test.info().project.use.baseURL}/`);
  expect(await context.cookies()).toEqual([]);
});

test("confirmation works with scripts disabled", async ({ browser }) => {
  const baseURL = String(test.info().project.use.baseURL);
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(VIEWER);
    await expect(page.getByRole("heading", { name: "Confirm you are 13+?" })).toBeVisible();
    await page.getByRole("button", { name: "Yes, continue", exact: true }).click();
    await expect(page.locator("#shell")).toBeVisible();
    expect((await context.cookies()).map((cookie) => cookie.name)).toEqual(["rh_session"]);
  } finally {
    await context.close();
  }
});


test("privacy is readable before entry on a small screen", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(VIEWER);
  await page.getByRole("link", { name: "Privacy", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Privacy at Ruby High", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "privacy@example.invalid", exact: true })).toBeVisible();
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/private/tmp/ruby-high-privacy-mobile.png", fullPage: true });
  await page.screenshot({ path: "/private/tmp/ruby-high-privacy-mobile-top.png" });
});

test("a guest can delete the account from account settings", async ({ page, context }) => {
  await openViewer(page);
  await dismissAnnouncements(page);
  await page.getByRole("button", { name: "Close student creator", exact: true }).click();
  await page.locator("#you-profile").click();
  await page.getByText("Account settings", { exact: true }).click();
  await page.locator("#account-delete").click();
  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Confirm you are 13+?", exact: true })).toBeVisible();
  expect(await context.cookies()).toEqual([]);
});


test("school sharing and teacher posts have separate choices", async ({ page }) => {
  await openViewer(page);
  const create = await page.request.post("/api/apps/ruby-high/session/browser-smoke/command", { data: {
    type: "create-character", name: "Mika", playbookId: "overachiever",
    stats: { head: 2, heart: 0, hustle: -1, honor: 1 }, arcAnswer: "Learn together.", personality: "Curious.",
  } });
  expect(create.ok()).toBe(true);
  const created = await create.json();
  expect(created.session.telemetry.character).toMatchObject({ publicWorldVisible: false, socialPostingConsent: false });
  await page.reload();
  await dismissAnnouncements(page);
  await page.locator("#you-profile").click();
  await expect(page.locator("#account-public-world-toggle")).toHaveText("Show");
  await expect(page.locator("#account-social-posting")).toHaveText("Allow posts");
  await page.locator("#account-public-world-toggle").click();
  await expect(page.locator("#account-public-world-toggle")).toHaveText("Hide");
  await expect(page.locator("#account-social-posting")).toHaveText("Allow posts");
  await page.locator("#account-social-posting").click();
  await expect(page.locator("#account-social-posting")).toHaveText("Stop posts");
  await expect(page.locator("#account-public-world-toggle")).toHaveText("Hide");
  await page.locator("#account-social-posting").click();
  await expect(page.locator("#account-social-posting")).toHaveText("Allow posts");
  await expect(page.locator("#account-public-world-toggle")).toHaveText("Hide");
  await page.getByText("Account settings", { exact: true }).click();
  await page.locator("#account-privacy-id").click();
  await expect(page.locator("#account-privacy-id-status")).toContainText("Privacy request ID");
});
