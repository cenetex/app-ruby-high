import { expect, test } from "@playwright/test";
import { closeBlockingSheetIfVisible, closeRewardComicIfVisible, contributeLiveRoomGoalForDev, createCharacter, createPublicCharacter, dismissAnnouncements, openViewer, tickGrade } from "./helpers.js";

test("boots as a guest, creates a character, answers a card, and opens account tabs", async ({ page }) => {
  const { errors } = await openViewer(page);
  await dismissAnnouncements(page);

  const lockButton = page.getByRole("button", { name: "Lock it in" });
  await expect(lockButton).toBeEnabled();
  await lockButton.click();

  await expect(lockButton).not.toBeVisible();
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

test("keeps the public world feed healthy across a live stream rollover", async ({ page }) => {
  test.setTimeout(80_000);
  const { errors } = await openViewer(page);
  await dismissAnnouncements(page);
  const panel = page.locator("#world-panel");
  const sub = page.locator("#world-panel-sub");

  await expect(panel).toBeVisible();
  await expect(sub).toContainText(/live|room/i);
  await expect(sub).not.toContainText(/paused|catching up|unavailable/i);

  await page.waitForTimeout(28_000);

  await expect(panel).toBeVisible();
  await expect(sub).toContainText(/live|room/i);
  await expect(sub).not.toContainText(/paused|catching up|unavailable/i);
  expect(errors).toEqual([]);
});

test("shows comic unlocks as a modal instead of an inline reward card", async ({ page }) => {
  test.setTimeout(35_000);
  const { errors } = await openViewer(page);
  await dismissAnnouncements(page);
  await createCharacter(page);

  await expect(page.locator(".comic-reader")).toHaveCount(0);
  await tickGrade(page);

  const modal = page.locator(".comic-reader.is-reward");
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await expect(modal).toHaveAttribute("role", "dialog");
  await expect(modal).toHaveAttribute("aria-modal", "true");
  await expect(modal).toContainText("Comic Page Unlocked");
  await expect(modal.locator("img")).toHaveAttribute("src", /\/assets\/comics\/first-bell\/page-\d+\.jpg/);

  await expect(page.getByText(/first bell card unlocked/i)).toHaveCount(0);
  await modal.getByRole("button", { name: "Close comic page" }).click();
  await expect(modal).not.toBeVisible();

  expect(errors).toEqual([]);
});

test("shows shared live-room Study Spark progress across browser clients", async ({ browser }) => {
  test.setTimeout(90_000);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const contextC = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const pageC = await contextC.newPage();
  const readWorld = async (page: typeof pageA) => page.evaluate(async () => {
    const resp = await fetch("/api/apps/ruby-high/world?limit=20", { credentials: "same-origin" });
    const body = await resp.json();
    if (!resp.ok) {
      throw new Error(`world fetch failed: ${JSON.stringify(body)}`);
    }
    return body.world;
  });
  try {
    const clientA = await openViewer(pageA);
    const clientB = await openViewer(pageB);
    const clientC = await openViewer(pageC);
    await dismissAnnouncements(pageA);
    await dismissAnnouncements(pageB);
    await dismissAnnouncements(pageC);
    await createPublicCharacter(pageA, "Noor Live");
    await createPublicCharacter(pageB, "Mina Live");
    await createPublicCharacter(pageC, "Sol Live");

    await tickGrade(pageA);
    await tickGrade(pageB);
    await tickGrade(pageC);
    await closeRewardComicIfVisible(pageA);
    await closeRewardComicIfVisible(pageB);
    await closeRewardComicIfVisible(pageC);

    const devContributionA = await contributeLiveRoomGoalForDev(pageA, "ruby");
    const devContributionB = await contributeLiveRoomGoalForDev(pageB, "ruby");
    const devContributionC = await contributeLiveRoomGoalForDev(pageC, "ruby");
    expect(Math.max(devContributionA.result?.progress ?? 0, devContributionB.result?.progress ?? 0)).toBeGreaterThanOrEqual(2);
    expect(devContributionC.result).toMatchObject({
      progress: 3,
      target: 3,
      complete: true,
      duplicate: false,
    });
    await closeRewardComicIfVisible(pageA);
    await closeRewardComicIfVisible(pageB);
    await closeRewardComicIfVisible(pageC);
    await closeBlockingSheetIfVisible(pageA);
    await closeBlockingSheetIfVisible(pageB);
    await closeBlockingSheetIfVisible(pageC);

    const refreshA = pageA.locator("#world-panel-refresh");
    const refreshB = pageB.locator("#world-panel-refresh");
    await expect(refreshA).toBeVisible();
    await expect(refreshB).toBeVisible();
    await refreshA.click();
    await refreshB.click();
    await expect(pageA.locator("#world-panel-sub")).toContainText("Study Spark", { timeout: 15_000 });
    await expect(pageB.locator("#world-panel-sub")).toContainText("Study Spark", { timeout: 15_000 });

    const worldA = await readWorld(pageA);
    const worldB = await readWorld(pageB);
    expect(worldA).toMatchObject({
      activeStudents: expect.any(Number),
      recentEvents: expect.arrayContaining([
        expect.objectContaining({
          kind: "room.goal-progress",
          complete: true,
          rewardLabel: expect.stringContaining("Study Spark"),
        }),
      ]),
      summary: { studySparks: { total: expect.any(Number) } },
    });
    expect(worldB).toMatchObject({
      activeStudents: expect.any(Number),
      recentEvents: expect.arrayContaining([
        expect.objectContaining({
          kind: "room.goal-progress",
          complete: true,
          rewardLabel: expect.stringContaining("Study Spark"),
        }),
      ]),
      summary: { studySparks: { total: expect.any(Number) } },
    });
    expect(worldA.summary.studySparks.total).toBeGreaterThanOrEqual(1);
    expect(worldB.summary.studySparks.total).toBeGreaterThanOrEqual(1);
    expect(clientA.errors).toEqual([]);
    expect(clientB.errors).toEqual([]);
    expect(clientC.errors).toEqual([]);
  } finally {
    await Promise.all([
      contextA.close().catch(() => {}),
      contextB.close().catch(() => {}),
      contextC.close().catch(() => {}),
    ]);
  }
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
