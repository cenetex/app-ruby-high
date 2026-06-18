import { expect, test } from "@playwright/test";
import {
  createCharacter,
  dismissAnnouncements,
  openViewer,
  tickGrade,
} from "./helpers.js";

test("full student journey: grades 9-12 with item system", async ({ page }) => {
  test.setTimeout(180_000);
  const { errors } = await openViewer(page);
  await dismissAnnouncements(page);
  await createCharacter(page);

  // Complete all 4 grades server-side.
  await tickGrade(page); // 9 → 10
  await tickGrade(page); // 10 → 11
  await tickGrade(page); // 11 → 12
  await tickGrade(page); // 12 → graduate

  // Load fresh page to see the final graduated state.
  await page.goto("/api/apps/ruby-high/viewer", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await dismissAnnouncements(page);
  await expect(page.locator("#you-state")).not.toHaveText(/checking/i, { timeout: 10000 });

  // Account & collectibles
  await expect(page.locator("#privy-action")).toBeVisible({ timeout: 10000 });
  await page.locator("#privy-action").click();
  await expect(page.locator("#privy-overlay")).toHaveClass(/is-open/);

  // Wallet — Merit Stars should be present.
  await page.locator("#account-tab-wallet").click();
  await expect(page.locator("#account-panel-wallet")).toBeVisible();
  const walletText = await page.locator("#account-panel-wallet").textContent();
  expect(walletText).toMatch(/Merit Stars|Hall Pass/i);

  // Library — comics section renders with collected and locked pages.
  await page.locator("#account-tab-library").click();
  await expect(page.locator("#account-panel-library")).toBeVisible();

  const comicsSection = page.locator("#account-comics");
  await expect(comicsSection).toBeVisible({ timeout: 5000 });

  const comicTiles = page.locator(".comic-page-tile");
  const tileCount = await comicTiles.count();
  expect(tileCount).toBeGreaterThan(0);

  const summaryText = await page.locator("#account-comic-summary").textContent();
  expect(summaryText).toMatch(/\d+\/\d+ pages found/);

  const libraryText = await page.locator("#account-panel-library").textContent();
  expect(libraryText).toMatch(/comic|pages found/i);

  await page.locator("#privy-close").click();
  await expect(page.locator("#privy-overlay")).not.toHaveClass(/is-open/);

  expect(errors.filter((e: string) => !e.includes("Service Worker") && !e.includes("401"))).toEqual([]);
});
