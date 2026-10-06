import { expect, test } from "@playwright/test";
import { stubPrivyBundle } from "./helpers.js";

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
