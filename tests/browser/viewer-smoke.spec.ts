import { expect, test } from "@playwright/test";
import { closeBlockingSheetIfVisible, closeFirstBellReportIfVisible, closeRewardComicIfVisible, contributeLiveRoomGoalForDev, createCharacter, createPublicCharacter, dismissAnnouncements, openViewer, tickGrade } from "./helpers.js";

test("canonical issue-174 link opens the Quick Roll/customize choice with bounded attribution", async ({ page }) => {
  let appOpenBody: Record<string, unknown> | null = null;
  page.on("request", (request) => {
    if (!request.url().endsWith("/api/apps/ruby-high/metrics/event")) return;
    const body = request.postDataJSON() as Record<string, unknown> | null;
    if (body?.type === "app_open") appOpenBody = body;
  });

  await page.goto(
    "/api/apps/ruby-high/viewer?rh_source=x&rh_campaign=issue-174-v1&rh_landing=quick-roll-v1&rh_entry=viewer",
    { waitUntil: "domcontentloaded" },
  );
  await expect.poll(() => appOpenBody).toMatchObject({
    type: "app_open",
    campaignSource: "x",
    campaignId: "issue-174-v1",
    landingVariant: "quick-roll-v1",
    entrypoint: "viewer",
  });
  expect(appOpenBody).not.toHaveProperty("path");
  expect(appOpenBody).not.toHaveProperty("referrer");
  await expect(page).not.toHaveURL(/rh_(source|campaign|landing|entry)=/);

  await dismissAnnouncements(page);
  await expect(page.locator("#sheet-overlay")).toHaveClass(/is-open/);
  await expect(page.locator(".is-creation-control-card .ccg-subtitle")).toContainText(
    "Edit the name and student style.",
  );
  await expect(page.locator(".creation-row")).toHaveCount(5);
  await expect(page.getByRole("textbox", { name: "Student name" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Student style" })).toBeVisible();
  await expect(page.getByRole("button", { name: /take my seat/i })).toBeEnabled();
});

test("enrolls a first student through the creation sheet into First Bell", async ({ page }) => {
  const { errors } = await openViewer(page);
  await dismissAnnouncements(page);

  await expect(page.getByRole("button", { name: "Lock it in" })).toHaveCount(0);

  const sheet = page.locator("#sheet-overlay");
  const rollAStudent = page.getByRole("button", { name: "Create my student" });
  if (!(await sheet.evaluate((element) => element.classList.contains("is-open")))) {
    await expect(rollAStudent).toBeVisible();
    await expect(rollAStudent).toBeEnabled();
    await rollAStudent.click();
  }

  await expect(sheet).toHaveClass(/is-open/);
  const takeSeat = page.getByRole("button", { name: /take my seat/i });
  await expect(takeSeat).toBeEnabled();
  await takeSeat.click();

  await expect(page.getByRole("button", { name: "Lock it in" })).toHaveCount(0);
  await expect(sheet).not.toHaveClass(/is-open/);
  await expect(page.locator("#daily-class-progress")).toContainText("Question 1");
  await expect(page.locator("#daily-class-progress")).toContainText("Your View");
  await expect(page.locator("#daily-class-progress")).toContainText("Result");
  await expect(page.locator(".answer:not([disabled])").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#stream")).not.toContainText("Make your first student");

  expect(errors).toEqual([]);
});

test("keeps creator editing and the start-class action reachable on a small phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const { errors } = await openViewer(page);
  await dismissAnnouncements(page);

  const sheet = page.getByRole("dialog", { name: "Create your Ruby High student" });
  if (!(await sheet.evaluate((element) => element.classList.contains("is-open")))) {
    await page.getByRole("button", { name: "Create my student" }).click();
  }

  await expect(sheet).toHaveClass(/is-open/);
  await expect(page.getByRole("button", { name: "Close student creator" })).toBeVisible();
  await page.getByRole("button", { name: "Customize", exact: true }).click();

  const name = page.getByRole("textbox", { name: "Student name" });
  const style = page.getByRole("combobox", { name: "Student style" });
  await expect(name).toBeFocused();
  await name.fill("Mina");
  await style.selectOption("outsider");
  await expect(page.locator(".is-creation-candidate-card .ccg-name")).toHaveText("Mina");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("button", { name: "Done editing" }).click();
  await expect(page.getByRole("button", { name: /take my seat/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /take my seat/i })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("keeps a specific Class Result after refresh with one truthful next step", async ({ page }) => {
  test.setTimeout(60_000);
  const { errors } = await openViewer(page);
  await dismissAnnouncements(page);
  await createCharacter(page);
  const continueUntilVisible = async (target: ReturnType<typeof page.locator>) => {
    const next = page.locator("#next-btn");
    const rewardComic = page.locator(".comic-reader.is-reward").first();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (await rewardComic.isVisible().catch(() => false)) {
        await closeRewardComicIfVisible(page);
      }
      const ready = await target.isVisible().catch(() => false)
        && !(await page.locator("#board-reveal").isVisible().catch(() => false));
      if (ready) return;
      if (await next.isVisible().catch(() => false) && await next.isEnabled().catch(() => false)) {
        await next.click();
      }
      await page.waitForTimeout(750);
    }
    await expect(target).toBeVisible();
    await expect(page.locator("#board-reveal")).toBeHidden();
  };

  for (let evidence = 0; evidence < 2; evidence += 1) {
    await page.locator(".answer:not([disabled])").first().click();
    await expect(page.locator("#board-reveal")).toBeVisible();
    await closeFirstBellReportIfVisible(page);
    if (evidence === 0) {
      await continueUntilVisible(page.locator(".answer:not([disabled])").first());
    } else {
      await continueUntilVisible(page.locator("#typed-answer-input"));
    }
  }

  const finalResponse = "I would verify the claim against a named source before I trust it.";
  await page.locator("#typed-answer-input").fill(finalResponse);
  await page.locator("#typed-submit-btn").click();
  await expect(page.locator("#board-reveal")).toBeVisible({ timeout: 15_000 });

  const report = page.locator(".class-report-card");
  await continueUntilVisible(report);
  await expect(report.locator(".class-report-title")).toContainText("class result");
  await expect(report.locator(".class-result-prompt")).toContainText("Final prompt:");
  await expect(report.locator(".class-result-section.observation")).toContainText("What Ruby noticed");
  await expect(report.locator(".class-result-section.observation")).toContainText(finalResponse);
  await expect(report.locator(".class-result-section.consequence")).toContainText(/class recorded|mark recorded/i);
  await expect(report.locator(".class-result-section.progress")).toContainText("Course progress");
  const nextStep = page.locator(".class-report-next");
  await expect(nextStep).toContainText("Sign up to continue");
  await expect(nextStep).toContainText(/guest lesson is complete/i);
  const resultText = await report.textContent();

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(report).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.reload();
  await dismissAnnouncements(page);
  await expect(page.locator(".class-report-card")).toBeVisible();
  await expect(page.locator(".class-report-card")).toHaveText(resultText || "");
  expect(errors).toEqual([]);
});

test("keeps the generated student as a preview until the player takes their seat", async ({ page }) => {
  const { errors } = await openViewer(page);
  await dismissAnnouncements(page);

  await expect(page.getByRole("button", { name: /take my seat/i })).toBeVisible();
  await page.locator("#sheet-close").click();

  await page.reload();
  await dismissAnnouncements(page);
  await expect(page.getByRole("button", { name: "Create my student", exact: true })).toBeVisible();
  await expect(page.locator(".answer:not([disabled])")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("boots as a guest, creates a character, answers a card, and opens account tabs", async ({ page }) => {
  const { errors } = await openViewer(page);
  await dismissAnnouncements(page);

  await createCharacter(page);
  const firstAnswer = page.locator(".answer:not([disabled])").first();
  await expect(firstAnswer).toBeVisible();
  await expect(page.locator("#next-btn")).toBeHidden();
  await firstAnswer.click();
  await expect(page.locator("#board-reveal")).toBeVisible();
  const reportModal = page.locator(".first-bell-overlay");
  await expect(reportModal).toBeVisible();
  await expect(page.locator("#shell")).toHaveAttribute("inert", "");
  await expect(page.locator("#shell")).toHaveAttribute("aria-hidden", "true");
  await expect(reportModal.getByRole("button", { name: "Continue" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(reportModal.getByRole("button", { name: "Open student card" })).toBeFocused();
  await reportModal.getByRole("button", { name: "Continue" }).click();
  await expect(reportModal).not.toBeVisible();
  await expect(page.locator(".answer.is-correct")).toHaveCSS("opacity", "1");
  await expect(page.locator("#shell")).not.toHaveAttribute("inert", "");
  await expect(page.locator("#shell")).not.toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#next-btn")).toBeFocused();

  await expect(page.locator("#you-profile")).toHaveAttribute("aria-label", /Open .+'s student card/);
  await expect(page.locator(".teacher-profile-button").first()).toBeVisible();
  await expect(page.locator(".room-row-button").first()).toBeVisible();
  await expect(page.locator(".room-row-group button button")).toHaveCount(0);

  await expect(page.locator("#privy-action")).toBeVisible();
  await page.locator("#privy-action").click();
  const accountOverlay = page.locator("#privy-overlay");
  const accountDialog = page.getByRole("dialog", { name: "Account" });
  await expect(accountDialog).toHaveClass(/is-open/);
  await expect(accountDialog).toHaveAttribute("aria-modal", "true");
  await expect(accountDialog).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#shell")).toHaveAttribute("inert", "");
  await expect(page.locator("#shell")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#account-tab-account")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#account-tab-wallet")).toBeFocused();
  await expect(page.locator("#account-panel-wallet")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#account-tab-account")).toBeFocused();
  await expect(page.locator("#account-panel-account")).toBeVisible();

  await page.locator("#privy-close").focus();
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest("#privy-overlay")?.id || "")).toBe("privy-overlay");
  await page.keyboard.press("Escape");
  await expect(accountOverlay).not.toHaveClass(/is-open/);
  await expect(page.locator("#shell")).not.toHaveAttribute("inert", "");
  await expect(page.locator("#shell")).not.toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#privy-action")).toBeFocused();

  await page.locator("#privy-action").click();
  await expect(accountOverlay).toHaveClass(/is-open/);
  await page.locator("#account-tab-wallet").click();
  await expect(page.locator("#account-panel-wallet")).toBeVisible();
  await page.locator("#account-tab-library").click();
  await expect(page.locator("#account-panel-library")).toBeVisible();
  await page.locator("#privy-close").click();
  await expect(accountOverlay).not.toHaveClass(/is-open/);

  expect(errors).toEqual([]);
});

test("keeps morning announcements keyboard-modal", async ({ page }) => {
  const { errors } = await openViewer(page);
  const announcements = page.locator("#announcements-overlay");
  await expect(announcements).toBeVisible();
  await expect(page.locator("#shell")).toHaveAttribute("inert", "");
  await expect(page.locator("#announcements-dismiss")).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.locator("#announcements-dismiss")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#announcements-dismiss")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(announcements).not.toBeVisible();
  await expect(page.locator("#shell")).not.toHaveAttribute("inert", "");
  expect(errors).toEqual([]);
});

test("keeps Honor Roll open across session polling and returns to class", async ({ page }) => {
  const { errors } = await openViewer(page);
  await dismissAnnouncements(page);
  await createPublicCharacter(page, "Honor Roll Mina");
  await tickGrade(page);
  await page.reload();
  await dismissAnnouncements(page);
  await closeRewardComicIfVisible(page);
  await closeBlockingSheetIfVisible(page);

  const honorRoll = page.getByRole("button", { name: "View Honor Roll", exact: true });
  await expect(honorRoll).toBeVisible();
  await honorRoll.click();

  const panel = page.locator("#leaderboard-panel");
  await expect(panel).toBeVisible();
  await expect(page.locator("#leaderboard-back")).toBeFocused();
  await expect(page.locator("#leaderboard-body")).not.toContainText("Loading…");

  // The viewer polls session telemetry every four seconds while idle. That
  // repaint used to call showClassSurface() and immediately hide Honor Roll.
  await page.waitForTimeout(4_500);
  await expect(panel).toBeVisible();

  await page.locator("#leaderboard-back").click();
  await expect(panel).not.toBeVisible();
  await expect(page.locator("#blackboard-panel")).toBeVisible();
  await expect(page.locator("#honor-roll-button")).toBeFocused();
  expect(errors).toEqual([]);
});

test("keeps the public world projection healthy while the viewer idles", async ({ page }) => {
  test.setTimeout(80_000);
  const { errors } = await openViewer(page);
  await dismissAnnouncements(page);
  const readWorld = async () => page.evaluate(async () => {
    const resp = await fetch("/api/apps/ruby-high/world?limit=20", { credentials: "same-origin" });
    const body = await resp.json();
    if (!resp.ok) {
      throw new Error(`world fetch failed: ${JSON.stringify(body)}`);
    }
    return body.world;
  });

  await expect.poll(async () => {
    const world = await readWorld();
      return {
        activeStudents: typeof world.activeStudents,
        activeRooms: Array.isArray(world.activeRooms),
        recentEvents: Array.isArray(world.recentEvents),
      };
  }).toEqual({ activeStudents: "number", activeRooms: true, recentEvents: true });

  await page.waitForTimeout(28_000);

  const world = await readWorld();
  expect(world).toMatchObject({
    activeStudents: expect.any(Number),
    activeRooms: expect.any(Array),
    recentEvents: expect.any(Array),
    summary: expect.any(Object),
  });
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

    await expect.poll(async () => {
      const world = await readWorld(pageA);
      return world.summary?.studySparks?.total ?? 0;
    }).toBeGreaterThanOrEqual(1);

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
