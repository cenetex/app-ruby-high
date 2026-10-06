import { expect, test } from "@playwright/test";
import { completeAgeCheck } from "./helpers.js";

test("asks age before client scripts, tracking, or guest identity", async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.goto("/api/apps/ruby-high/viewer?rh_source=x&rh_campaign=outreach-v1");
  await expect(page.getByLabel("How old are you?")).toBeVisible();
  expect(requests).toEqual(["/api/apps/ruby-high/viewer"]);
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await completeAgeCheck(page);
  await expect(page.locator("#shell")).toBeVisible();
  await expect.poll(async () => (await context.cookies()).map((cookie) => cookie.name)).toContain("rh_session");
  const group = (await context.cookies()).find((cookie) => cookie.name === "rh_age_group");
  expect(group?.value).toMatch(/^v1\.eligible\./);
  expect(group?.httpOnly).toBe(true);
  expect(group?.sameSite).toBe("Lax");
});

test("retains the younger age group through form retry and viewer reload", async ({ page, context }) => {
  await page.goto("/api/apps/ruby-high/viewer");
  await page.getByLabel("How old are you?").fill("12");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading")).toHaveText("Thanks for checking.");
  expect((await context.cookies()).map((cookie) => cookie.name)).toEqual(["rh_age_group"]);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  const retry = await page.request.post("/api/apps/ruby-high/age-check", {
    headers: { Origin: new URL(page.url()).origin }, form: { age: "18" },
  });
  expect(retry.status()).toBe(403);
  await page.goto("/api/apps/ruby-high/viewer");
  await expect(page.getByRole("heading")).toHaveText("Thanks for checking.");
  const guest = await page.request.post("/api/apps/ruby-high/auth/guest");
  expect(guest.status()).toBe(428);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test("the age form works with scripts disabled", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  try {
    await page.goto("/api/apps/ruby-high/viewer");
    await page.getByLabel("How old are you?").fill("13");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.locator("#shell")).toBeVisible();
    expect((await context.cookies()).find((cookie) => cookie.name === "rh_age_group")?.value).toMatch(/^v1\.eligible\./);
  } finally {
    await context.close();
  }
});
