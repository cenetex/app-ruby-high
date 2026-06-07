import { expect, test } from "@playwright/test";
import {
  createCharacter,
  dismissAnnouncements,
  openViewer,
} from "./helpers.js";

test("boots as a guest, creates a character, answers a card, and opens account tabs", async ({ page }) => {
  const { errors } = await openViewer(page);
  await dismissAnnouncements(page);
  await createCharacter(page);

  const firstAnswer = page.locator(".answer:not([disabled])").first();
  await expect(firstAnswer).toBeVisible();
  await firstAnswer.click();
  await expect(page.locator("#board-reveal")).toBeVisible();

  await expect(page.locator("#privy-action")).toBeVisible();
  await page.locator("#privy-action").click();
  await expect(page.locator("#privy-overlay")).toHaveClass(/is-open/);
  await page.locator("#account-tab-wallet").click();
  await expect(page.locator("#account-panel-wallet")).toBeVisible();
  await page.locator("#account-tab-library").click();
  await expect(page.locator("#account-panel-library")).toBeVisible();
  await page.locator("#privy-close").click();
  await expect(page.locator("#privy-overlay")).not.toHaveClass(/is-open/);

  expect(errors).toEqual([]);
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const) {
  test(`keeps the viewer framed on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const { errors } = await openViewer(page);

    const metrics = await page.evaluate(() => {
      const shell = document.querySelector("#shell")?.getBoundingClientRect();
      const board = document.querySelector("#blackboard-panel")?.getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        shellWidth: shell?.width ?? 0,
        shellHeight: shell?.height ?? 0,
        boardWidth: board?.width ?? 0,
        boardHeight: board?.height ?? 0,
      };
    });

    expect(metrics.shellWidth).toBeGreaterThan(0);
    expect(metrics.shellHeight).toBeGreaterThan(0);
    expect(metrics.boardWidth).toBeGreaterThan(0);
    expect(metrics.boardHeight).toBeGreaterThan(0);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 8);
    expect(errors).toEqual([]);
  });
}
