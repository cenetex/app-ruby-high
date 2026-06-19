import { expect, test } from "@playwright/test";
import { answerLiveRoomQuestion, closeRewardComicIfVisible, createCharacter, dismissAnnouncements, openViewer, tickGrade } from "./helpers.js";

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

test("shows shared live-room progress across two browser clients", async ({ browser }) => {
  test.setTimeout(90_000);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
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
    await dismissAnnouncements(pageA);
    await dismissAnnouncements(pageB);
    await createCharacter(pageA);
    await createCharacter(pageB);

    await tickGrade(pageA);
    await tickGrade(pageB);
    await closeRewardComicIfVisible(pageA);
    await closeRewardComicIfVisible(pageB);

    await expect.poll(async () => {
      const response = await answerLiveRoomQuestion(pageA, "ruby");
      return {
        faculty: response.session?.telemetry?.faculty,
        lastReveal: response.session?.telemetry?.lastReveal,
      };
    }, { timeout: 15_000 }).toMatchObject({
      faculty: "ruby",
      lastReveal: expect.objectContaining({ picked: expect.any(String) }),
    });
    await expect.poll(async () => {
      const response = await answerLiveRoomQuestion(pageB, "ruby");
      return {
        faculty: response.session?.telemetry?.faculty,
        lastReveal: response.session?.telemetry?.lastReveal,
      };
    }, { timeout: 15_000 }).toMatchObject({
      faculty: "ruby",
      lastReveal: expect.objectContaining({ picked: expect.any(String) }),
    });

    const refreshA = pageA.locator("#world-panel-refresh");
    const refreshB = pageB.locator("#world-panel-refresh");
    await expect(refreshA).toBeVisible();
    await expect(refreshB).toBeVisible();

    await expect.poll(async () => {
      await refreshA.click();
      const world = await readWorld(pageA);
      const rubyRoom = (world.activeRooms || []).find((room: any) => room.facultyId === "ruby");
      return rubyRoom?.goal?.progress ?? 0;
    }, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);

    await expect.poll(async () => {
      await refreshB.click();
      const world = await readWorld(pageB);
      const rubyRoom = (world.activeRooms || []).find((room: any) => room.facultyId === "ruby");
      return rubyRoom?.goal?.progress ?? 0;
    }, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);

    await expect(pageA.locator("#world-panel-sub")).toContainText(/2 students live|live/i);
    await expect(pageB.locator("#world-panel-sub")).toContainText(/2 students live|live/i);
    const worldA = await readWorld(pageA);
    const worldB = await readWorld(pageB);
    expect(worldA.recentEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "room.goal-progress",
        faculty: "ruby",
        progress: expect.any(Number),
        target: 3,
      }),
    ]));
    expect(worldB.recentEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "room.goal-progress",
        faculty: "ruby",
        progress: expect.any(Number),
        target: 3,
      }),
    ]));
    expect(Math.max(...worldA.recentEvents.filter((event: any) => event.kind === "room.goal-progress" && event.faculty === "ruby").map((event: any) => event.progress))).toBeGreaterThanOrEqual(2);
    expect(Math.max(...worldB.recentEvents.filter((event: any) => event.kind === "room.goal-progress" && event.faculty === "ruby").map((event: any) => event.progress))).toBeGreaterThanOrEqual(2);
    await expect(pageA.locator("#world-panel-events")).not.toContainText(/Noor|Mina|rh:guest/i);
    await expect(pageB.locator("#world-panel-events")).not.toContainText(/Noor|Mina|rh:guest/i);
    expect(clientA.errors).toEqual([]);
    expect(clientB.errors).toEqual([]);
  } finally {
    await contextA.close();
    await contextB.close();
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
