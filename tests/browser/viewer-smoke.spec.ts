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
    "Stats, voice, rerolls, and custom portraits are optional.",
  );
  await expect(page.locator(".creation-row")).toHaveCount(5);
  await expect(page.getByRole("textbox", { name: "Student name" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Student style" })).toBeVisible();
  await expect(page.getByRole("button", { name: /start first class/i })).toBeEnabled();
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
  const takeSeat = page.getByRole("button", { name: /start first class/i });
  await expect(takeSeat).toBeEnabled();
  await takeSeat.click();

  await expect(page.getByRole("button", { name: "Lock it in" })).toHaveCount(0);
  await expect(sheet).not.toHaveClass(/is-open/);
  await expect(page.locator("#daily-class-progress")).toContainText("Question 1");
  await expect(page.locator("#daily-class-progress")).toContainText("Build a Case");
  await expect(page.locator("#daily-class-progress")).toContainText("Result");
  await expect(page.locator(".answer:not([disabled])").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#stream")).not.toContainText("Make your first student");

  expect(errors).toEqual([]);
});

test("keeps creator editing and the start-class action reachable on a small phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const { errors } = await openViewer(page);
  await dismissAnnouncements(page);

  const sheet = page.locator("#sheet-overlay");
  if (!(await sheet.evaluate((element) => element.classList.contains("is-open")))) {
    await page.getByRole("button", { name: "Create my student" }).click();
  }

  await expect(sheet).toHaveClass(/is-open/);
  await expect(page.getByRole("button", { name: "Close student creator" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Student name" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Student style" })).toBeVisible();
  await page.getByRole("button", { name: "Advanced", exact: true }).click();

  const name = page.getByRole("textbox", { name: "Student name" });
  const style = page.getByRole("combobox", { name: "Student style" });
  await expect(page.getByRole("button", { name: "Try another stats" })).toBeFocused();
  await name.fill("Mina");
  await style.selectOption("outsider");
  await expect(page.locator(".is-creation-candidate-card .ccg-name")).toHaveText("Mina");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: /start first class/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /start first class/i })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("gives challenge and chat their own full phone view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await openViewer(page);
  await dismissAnnouncements(page);
  await createCharacter(page);

  const toggle = page.getByRole("tablist", { name: "Classroom view" });
  const challengeTab = page.getByRole("tab", { name: "Challenge" });
  const chatTab = page.getByRole("tab", { name: "Chat", exact: true });
  await expect(toggle).toBeVisible();
  await expect(challengeTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#blackboard-panel")).toBeVisible();
  await expect(page.locator("#stream")).toBeHidden();

  await chatTab.click();
  await expect(chatTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#blackboard-panel")).toBeHidden();
  await expect(page.locator("#stream")).toBeVisible();

  await challengeTab.click();
  await expect(page.locator("#blackboard-panel")).toBeVisible();
  await expect(page.locator("#stream")).toBeHidden();
  expect(errors).toEqual([]);
});

test("keeps roll results in the conversation without scene controls", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { errors } = await openViewer(page);
  await dismissAnnouncements(page);
  await createCharacter(page);

  await page.locator(".answer:not([disabled])").first().click();
  await expect(page.locator(".first-bell-overlay")).toBeVisible();
  await closeFirstBellReportIfVisible(page);
  await expect(page.locator("#board-reveal")).toBeVisible();
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await expect(page.locator("#stream .class-note-result")).toBeVisible();
  await expect(page.locator("#scene-summary-host, #dialogue-log, #scene-latest")).toHaveCount(0);

  const layout = await page.evaluate(() => ({
    boardOverflow: getComputedStyle(document.getElementById("board")!).overflowY,
    streamOverflow: getComputedStyle(document.getElementById("stream")!).overflowY,
    resultItems: document.querySelectorAll("#stream .class-note-result").length,
  }));
  expect(layout).toEqual({
    boardOverflow: "auto",
    streamOverflow: "auto",
    resultItems: 1,
  });
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
      await continueUntilVisible(page.locator("#response-builder"));
    }
  }

  await page.locator('[data-response-group="claim"] [data-response-card]:not([hidden])').first().click();
  await page.locator('[data-response-group="stance"] [data-response-card][data-value="conditional"]').click();
  await page.locator('[data-response-group="evidence"] [data-response-card][data-value="source"]').click();
  await page.locator('[data-response-group="impact"] [data-response-card][data-value="systems"]').click();
  await expect(page.locator("#typed-submit-btn")).toBeEnabled();
  await page.locator("#typed-submit-btn").click();
  await expect(page.locator("#board-reveal")).toBeVisible({ timeout: 15_000 });

  const report = page.locator(".class-report-card");
  await continueUntilVisible(report);
  await expect(report.locator(".class-report-title")).toContainText("class result");
  await expect(report.locator(".class-result-prompt")).toContainText("Final prompt:");
  await expect(report.locator(".class-result-section.observation")).toContainText("What Ruby noticed");
  await expect(report.locator(".class-result-section.observation")).toContainText("depends on the context and who is affected");
  await expect(report.locator(".class-result-section.observation")).toContainText("judge it by the wider system and its rules");
  await expect(report.locator(".class-result-section.consequence")).toContainText(/class recorded|mark recorded/i);
  await expect(report.locator(".class-result-section.progress")).toContainText("Course progress");
  await expect(page.locator(".class-report-next")).toContainText(/sign up to continue/i);
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

test("keeps Roko's Return response builder actionable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await openViewer(page);
  await dismissAnnouncements(page);

  const launchUrl = await page.evaluate(async () => {
    const post = async (path: string, body: Record<string, unknown>, authorization?: string) => {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(`${path} failed: ${JSON.stringify(result)}`);
      return result;
    };
    const device = await post("/api/apps/ruby-high/agent/v1/device/code", {
      agentName: "Roko Return Browser Test",
      scopes: ["school:read", "student:play"],
    });
    await post("/api/apps/ruby-high/agent/v1/device/approve", { userCode: device.userCode });
    const token = await post("/api/apps/ruby-high/agent/v1/device/token", { deviceCode: device.deviceCode });
    const launch = await post("/api/apps/ruby-high/agent/v1/launch", {}, token.accessToken);
    return String(launch.launchUrl);
  });

  await page.goto(launchUrl);
  const agentCookie = (await page.context().cookies()).find((cookie) => cookie.name === "rh_agent_session");
  expect(agentCookie).toBeDefined();
  await page.context().clearCookies();
  await page.context().addCookies([agentCookie!]);

  const finalTelemetry = await page.evaluate(async () => {
    const command = async (payload: Record<string, unknown>) => {
      const response = await fetch("/api/apps/ruby-high/session/browser-smoke/command", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(`command ${String(payload.type)} failed: ${JSON.stringify(result)}`);
      return result;
    };
    await command({
      type: "create-character",
      name: "Route Tester",
      playbookId: "overachiever",
      stats: { head: 2, heart: 0, hustle: -1, honor: 1 },
      arcAnswer: "I update when the route changes.",
      personality: "Careful and curious.",
    });
    await command({ type: "select-grade", grade: "10" });
    await command({ type: "set-faculty", faculty: "roko" });
    let result = await command({ type: "pick", faculty: "roko" });
    for (let room = 0; room < 3; room += 1) {
      if (result?.session?.telemetry?.current?.type !== "story-action") {
        throw new Error(`expected Roko story action: ${JSON.stringify(result)}`);
      }
      await command({ type: "answer-text", answerText: "head" });
      await command({ type: "clear" });
      result = await command({ type: "pick", faculty: "roko" });
    }
    return result?.session?.telemetry;
  });

  expect(finalTelemetry?.current?.type).toBe("opinion");
  expect(finalTelemetry?.response_claims).toHaveLength(2);
  await page.goto("/api/apps/ruby-high/viewer");
  await dismissAnnouncements(page);
  const activeAgentCookie = (await page.context().cookies()).find((cookie) => cookie.name === "rh_agent_session");
  expect(activeAgentCookie).toBeDefined();
  await page.context().clearCookies();
  await page.context().addCookies([activeAgentCookie!]);

  const claimCards = page.locator('[data-response-group="claim"] [data-response-card]:not([hidden])');
  await expect(page.locator("#response-builder")).toBeVisible();
  await expect(claimCards).toHaveCount(2);
  await expect(claimCards.first()).toContainText("Readers can test the logic");
  await claimCards.first().click();
  await page.locator('[data-response-group="stance"] [data-response-card][data-value="conditional"]').click();
  await page.locator('[data-response-group="evidence"] [data-response-card][data-value="source"]').click();
  await page.locator('[data-response-group="impact"] [data-response-card][data-value="systems"]').click();
  await expect(page.locator("#typed-submit-btn")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("keeps the generated student as a preview until the player takes their seat", async ({ page }) => {
  const { errors } = await openViewer(page);
  await dismissAnnouncements(page);

  await expect(page.locator("#sheet-overlay")).toHaveClass(/is-open/);
  await expect(page.getByRole("button", { name: /start first class/i })).toBeVisible();
  await page.locator("#sheet-close").click();

  await page.reload();
  await dismissAnnouncements(page);
  await expect(page.locator("#sheet-overlay")).toHaveClass(/is-open/);
  await expect(page.getByRole("button", { name: /start first class/i })).toBeVisible();
  await expect(page.locator(".answer:not([disabled])")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("boots as a guest, creates a character, answers a card, and opens account tabs", async ({ page }) => {
  const { errors, privyRequests } = await openViewer(page);
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
  expect(privyRequests()).toBe(0);
  const accountOverlay = page.locator("#privy-overlay");
  const accountDialog = page.getByRole("dialog", { name: "Account" });
  await expect(accountDialog).toHaveClass(/is-open/);
  await expect(accountDialog).toHaveAttribute("aria-modal", "true");
  await expect(accountDialog).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#passkey-action")).toHaveText("Sign in with a passkey");
  await expect(page.locator("#passkey-create")).toHaveText("Save progress with a passkey");
  await expect(page.locator("#shell")).toHaveAttribute("inert", "");
  await expect(page.locator("#shell")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#passkey-autofill")).toBeFocused();
  await page.locator("#account-tab-account").focus();
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

test("manages passkeys, signs out cleanly, and recovers the same student", async ({ page }) => {
  test.setTimeout(150_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  let backupAuthenticatorId = "";
  let primaryAuthenticatorRemoved = false;

  try {
    const { errors, privyRequests } = await openViewer(page);
    await dismissAnnouncements(page);
    await createCharacter(page);
    const studentName = (await page.locator("#you-name").textContent())?.trim();
    const firstVisitorId = await page.evaluate(() => localStorage.getItem("ruby-high:visitor-id"));

    await page.locator("#privy-action").click();
    await page.locator("#passkey-create").click();
    await expect(page.locator("#privy-status")).toContainText("Passkey ready");
    await expect(page.locator("#passkey-recovery-code")).toBeVisible();
    const firstRecoveryCode = (await page.locator("#passkey-recovery-value").textContent())?.trim() || "";
    expect(firstRecoveryCode).toMatch(/^[A-Z2-9]{5}(?:-[A-Z2-9]{5}){3}$/);
    await expect(page.locator("#privy-wallet")).toHaveText("Passkey account");
    await expect(page.locator("#passkey-action")).toBeHidden();
    await expect(page.locator("#privy-signout")).toBeVisible();
    await expect(page.locator(".passkey-row")).toHaveCount(1);

    const primaryCredentials = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
    for (const credential of primaryCredentials.credentials) {
      await cdp.send("WebAuthn.removeCredential", { authenticatorId, credentialId: credential.credentialId });
    }
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    primaryAuthenticatorRemoved = true;
    const backupAuthenticator = await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "usb",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    backupAuthenticatorId = backupAuthenticator.authenticatorId;
    await page.locator("#passkey-create").click();
    await expect(page.locator(".passkey-row")).toHaveCount(2);
    await page.locator(".passkey-row").first().getByRole("button", { name: "Delete" }).click();
    await page.locator("#app-confirm-ok").click();
    await expect(page.locator(".passkey-row")).toHaveCount(1);

    await page.locator("#privy-signout").click();
    await expect(page.locator("#passkey-action")).toBeVisible();
    const freshMe = await page.evaluate(async () => {
      const response = await fetch("/api/apps/ruby-high/auth/me", { credentials: "same-origin" });
      return response.json();
    });
    expect(freshMe.passkey).toMatchObject({ registered: false, authenticated: false });
    const secondVisitorId = await page.evaluate(() => localStorage.getItem("ruby-high:visitor-id"));
    expect(secondVisitorId).toBeTruthy();
    expect(secondVisitorId).not.toBe(firstVisitorId);
    await page.locator("#passkey-action").click();
    await expect(page.locator("#privy-status")).toHaveText("Signed in with your passkey.");
    await expect(page.locator("#privy-wallet")).toHaveText("Passkey account");
    await expect(page.locator("#you-name")).toHaveText(studentName || "");

    const me = await page.evaluate(async () => {
      const response = await fetch("/api/apps/ruby-high/auth/me", { credentials: "same-origin" });
      return response.json();
    });
    expect(me.passkey).toMatchObject({
      available: true,
      registered: true,
      authenticated: true,
      recent: true,
      recoveryConfigured: true,
    });
    expect(me.passkey.credentials).toHaveLength(1);

    await expect(page.locator("#sheet-overlay")).not.toHaveClass(/is-open/);
    await expect(page.locator("#privy-signout")).toBeVisible();
    await page.locator("#privy-signout").click();
    for (const currentAuthenticatorId of [backupAuthenticatorId]) {
      const credentials = await cdp.send("WebAuthn.getCredentials", { authenticatorId: currentAuthenticatorId });
      for (const credential of credentials.credentials) {
        await cdp.send("WebAuthn.removeCredential", {
          authenticatorId: currentAuthenticatorId,
          credentialId: credential.credentialId,
        });
      }
    }
    await page.locator("#passkey-recovery-input").fill(firstRecoveryCode);
    await page.locator("#passkey-recovery-submit").click();
    await expect(page.locator("#privy-status")).toContainText("Account recovered");
    await expect(page.locator("#you-name")).toHaveText(studentName || "");
    const rotatedRecoveryCode = (await page.locator("#passkey-recovery-value").textContent())?.trim() || "";
    expect(rotatedRecoveryCode).toMatch(/^[A-Z2-9]{5}(?:-[A-Z2-9]{5}){3}$/);
    expect(rotatedRecoveryCode).not.toBe(firstRecoveryCode);
    expect(privyRequests()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    if (backupAuthenticatorId) {
      await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: backupAuthenticatorId });
    }
    if (!primaryAuthenticatorRemoved) {
      await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    }
    await cdp.send("WebAuthn.disable");
  }
});

test("uses one welcome layer, then keeps announcements for returning students", async ({ page }) => {
  const { errors } = await openViewer(page);
  const announcements = page.locator("#announcements-overlay");
  await expect(announcements).not.toBeVisible();
  await expect(page.locator("#sheet-overlay")).toHaveClass(/is-open/);
  await expect(page.getByRole("button", { name: /start first class/i })).toBeVisible();
  await createCharacter(page);
  await expect(announcements).not.toBeVisible();
  await page.evaluate(() => localStorage.removeItem("ruby-high:announcements-last-date"));
  await page.reload();
  await expect(announcements).toBeVisible();
  await expect(page.locator("#shell")).toHaveAttribute("inert", "");
  await expect(page.locator("#announcements-dismiss")).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.locator("#announcements-about")).toBeFocused();
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
  test.setTimeout(45_000);
  const { errors } = await openViewer(page);
  await dismissAnnouncements(page);
  await createCharacter(page);

  await expect(page.locator(".comic-reader")).toHaveCount(0);
  await tickGrade(page);

  const modal = page.locator(".comic-reader.is-reward");
  await expect(modal).toBeVisible({ timeout: 20_000 });
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
