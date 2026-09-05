import { expect, test } from "@playwright/test";
import { createCharacter, dismissAnnouncements, openViewer, closeBlockingSheetIfVisible, closeRewardComicIfVisible, tickGrade } from "./helpers.js";

for (const width of [320, 390, 768, 1280]) {
  test(`keeps a class and its navigation usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { errors, privyRequests } = await openViewer(page);
    await dismissAnnouncements(page);
    await createCharacter(page);
    const question = await page.locator("#board-prompt").innerText();
    const answer = page.locator(".answer:not([disabled])").first();
    await expect(answer).toBeVisible();
    const answerSpacing = await answer.evaluate((el) => {
      const badge = el.querySelector(".badge")!.getBoundingClientRect();
      const label = el.querySelector(".label")!.getBoundingClientRect();
      return label.left - badge.right;
    });
    expect(answerSpacing).toBeGreaterThanOrEqual(8);
    await expect(page.getByRole("button", { name: "Class", exact: true })).toHaveAttribute("aria-current", "page");
    const headerHeight = await page.locator(".app-header").evaluate((el) => el.getBoundingClientRect().height);
    expect(headerHeight).toBeLessThan(90);
    if (width === 390 || width === 1280) await page.screenshot({ path: `test-outputs/unified-ui/${width}-class.png` });

    await page.getByRole("button", { name: "Campus", exact: true }).click();
    await expect(page.locator("#campus-title")).toBeFocused();
    await expect(page.getByRole("button", { name: "Open science classroom", exact: true })).toBeVisible();
    const roomSpacing = await page.locator(".room-row-group").first().evaluate((el) => {
      const portrait = el.querySelector(".teacher-profile-button")!.getBoundingClientRect();
      const name = el.querySelector(".room-row-name")!.getBoundingClientRect();
      return name.left - portrait.right;
    });
    expect(roomSpacing).toBeGreaterThanOrEqual(8);
    if (width === 390 || width === 1280) await page.screenshot({ path: `test-outputs/unified-ui/${width}-campus.png` });
    await expect(page.locator("#class-page")).toBeHidden();
    await page.getByRole("button", { name: "Yearbook", exact: true }).click();
    await expect(page.locator("#yearbook-title")).toBeFocused();
    await expect(page.locator("#yearbook-record")).toContainText("This year's courses");
    if (width === 390 || width === 1280) await page.screenshot({ path: `test-outputs/unified-ui/${width}-yearbook.png` });
    await page.getByRole("button", { name: "Comics", exact: true }).click();
    await expect(page.locator("#yearbook-comics")).toBeVisible();
    await expect(page.locator("#yearbook-record")).toBeHidden();
    await page.getByRole("button", { name: "Open your account", exact: true }).click();
    await expect(page.locator("#account-title")).toBeFocused();
    await expect(page.locator("#shell")).not.toHaveAttribute("inert", "");
    const studentSpacing = await page.locator(".account-character-card").first().evaluate((el) => {
      const portrait = el.querySelector(".account-character-portrait")!.getBoundingClientRect();
      const name = el.querySelector(".account-character-name")!.getBoundingClientRect();
      return name.left - portrait.right;
    });
    expect(studentSpacing).toBeGreaterThanOrEqual(8);
    if (width === 390 || width === 1280) await page.screenshot({ path: `test-outputs/unified-ui/${width}-account.png` });
    await page.getByRole("button", { name: "Class", exact: true }).click();
    await expect(page.locator("#board-prompt")).toHaveText(question);
    await expect(answer).toBeVisible();
    await page.goBack();
    await expect(page.locator("#privy-overlay")).toBeVisible();
    await page.goBack();
    await expect(page.locator("#yearbook-comics")).toBeVisible();
    await page.reload();
    await dismissAnnouncements(page);
    await expect(page.locator("#yearbook-page")).toBeVisible();
    await expect(page.locator(".app-nav")).toBeVisible();
    const overflow = await page.locator("#workspace").evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(privyRequests()).toBe(0);
    expect(errors).toEqual([]);
  });
}

test("shows completed years and earned comics from the student's record", async ({ page }) => {
  const { errors } = await openViewer(page);
  await dismissAnnouncements(page);
  await createCharacter(page);
  await tickGrade(page);
  await page.reload();
  await dismissAnnouncements(page);
  await closeRewardComicIfVisible(page);
  await closeBlockingSheetIfVisible(page);
  await page.getByRole("button", { name: "Yearbook", exact: true }).click();
  await expect(page.locator("#yearbook-record")).toContainText("Completed years");
  await expect(page.locator("#yearbook-record .paper-archive-entry")).toHaveCount(1);
  await page.getByRole("button", { name: "Comics", exact: true }).click();
  await expect(page.locator("#account-comic-summary")).toContainText("pages found");
  await expect(page.locator("#yearbook-comics .comic-page-tile").first()).toBeVisible();
  const earnedComic = page.locator("#yearbook-comics .comic-page-tile.is-unlocked").first();
  await expect(earnedComic).toBeVisible();
  await earnedComic.focus();
  await page.waitForTimeout(16_000);
  await expect(earnedComic).toBeFocused();
  expect(errors).toEqual([]);
});

test("starts a first class from the empty Yearbook", async ({ page }) => {
  await openViewer(page);
  await dismissAnnouncements(page);
  await page.getByRole("button", { name: "Close student creator", exact: true }).click();
  await page.getByRole("button", { name: "Yearbook", exact: true }).click();
  await expect(page.locator("#yearbook-record")).toContainText("Your story starts with a student");
  await createCharacter(page);
  await expect(page.locator("#class-page")).toBeVisible();
  await expect(page.locator(".answer:not([disabled])").first()).toBeVisible();
});
