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

  // Library — items section renders with cards.
  await page.locator("#account-tab-library").click();
  await expect(page.locator("#account-panel-library")).toBeVisible();

  // Items section should be visible.
  const itemsSection = page.locator("#account-items");
  await expect(itemsSection).toBeVisible({ timeout: 5000 });

  // Should show item cards (collected items or locked placeholders).
  const itemCards = page.locator(".account-item-card");
  const cardCount = await itemCards.count();
  expect(cardCount).toBeGreaterThan(0);

  // Item summary shows count.
  const summaryText = await page.locator("#account-item-summary").textContent();
  expect(summaryText).toMatch(/\d+ collected/);

  // Comics section also renders.
  const libraryText = await page.locator("#account-panel-library").textContent();
  expect(libraryText).toMatch(/yearbook|comic|collected/i);

  await page.locator("#privy-close").click();
  await expect(page.locator("#privy-overlay")).not.toHaveClass(/is-open/);

  expect(errors.filter((e: string) => !e.includes("Service Worker") && !e.includes("401"))).toEqual([]);
});
