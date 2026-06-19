import { expect, type Page } from "@playwright/test";

export const PRIVY_CLIENT_STUB = `
window.RubyHighPrivyClientModule = {
  createRubyHighPrivyClient: async function () {
    const emptySession = {
      authenticated: false,
      userId: null,
      label: null,
      walletAddress: null,
      walletChainType: null,
      solanaWalletAddress: null,
      solanaAccountAddress: null
    };
    return {
      current: async function () { return emptySession; },
      login: async function () { return null; },
      connectSolanaWallet: async function () { return null; },
      logout: async function () {},
      paySolanaQuote: async function () { throw new Error("Privy smoke stub cannot pay"); },
      signSolanaTransaction: async function () { throw new Error("Privy smoke stub cannot sign"); },
      signAndSendSolanaTransaction: async function () { throw new Error("Privy smoke stub cannot send"); },
      onSession: function () { return function () {}; },
      onDiagnostic: function () { return function () {}; }
    };
  }
};
`;

export function watchRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  return errors;
}

export async function stubPrivyBundle(page: Page): Promise<() => number> {
  let requestCount = 0;
  await page.route(/\/api\/apps\/ruby-high\/assets\/privy-client\.global\.js(?:\?.*)?$/, async (route) => {
    requestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      body: PRIVY_CLIENT_STUB,
    });
  });
  return () => requestCount;
}

/**
 * Open the Ruby High viewer and wait for it to be ready (no sign-in overlay,
 * you-state not "checking", Privy stub was loaded). Returns the runtime error
 * collector so tests can assert errors are empty.
 */
export async function openViewer(page: Page) {
  const errors = watchRuntimeErrors(page);
  const privyRequests = await stubPrivyBundle(page);
  await page.goto("/api/apps/ruby-high/viewer");
  await expect(page).toHaveTitle(/Ruby High/);
  await expect(page.locator("#shell")).toBeVisible();
  await expect(page.locator("#signin-overlay")).not.toHaveClass(/is-open/);
  await expect.poll(async () => (await page.locator("#you-state").textContent()) ?? "")
    .not.toMatch(/checking/i);
  await expect.poll(privyRequests).toBeGreaterThan(0);
  await page.evaluate(async () => {
    const resp = await fetch("/api/apps/ruby-high/session/browser-smoke/command", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "mark-intro-seen" }),
    });
    const body = await resp.json();
    if (!resp.ok) {
      throw new Error(`guest session bootstrap failed: ${JSON.stringify(body)}`);
    }
  });
  return { errors };
}

/**
 * Dismiss the morning announcements overlay if visible.
 */
export async function dismissAnnouncements(page: Page) {
  const announcements = page.locator("#announcements-overlay");
  if (await announcements.isVisible().catch(() => false)) {
    await page.locator("#announcements-dismiss").click();
    await expect(announcements).not.toBeVisible({ timeout: 5000 });
  }
}

/**
 * Trigger character creation by clicking whichever affordance is visible
 * (Lock it in, Roll a student, or Save Character). Returns after the creation
 * controls have committed and the classroom is visible.
 */
export async function createCharacter(page: Page) {
  const lockItIn = page.getByRole("button", { name: "Lock it in" });
  const rollAStudent = page.getByRole("button", { name: /roll a student/i });
  const saveCharacter = page.locator("#sheet-card").getByRole("button", { name: "Save Character" });

  // Capture console errors for debugging.
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  const lockVisible = await lockItIn.isVisible().catch(() => false);
  const rollVisible = await rollAStudent.isVisible().catch(() => false);

  if (lockVisible) {
    try {
      await expect(lockItIn).toBeEnabled({ timeout: 45000 });
      await lockItIn.click();
    } catch {
      // Button never enabled — fall through to roll-a-student.
      if (rollVisible) {
        await rollAStudent.click();
      }
    }
  } else if (rollVisible) {
    await rollAStudent.click();
  }

  // Try Save Character if it appears.
  try {
    await expect(saveCharacter).toBeEnabled({ timeout: 5000 });
    await saveCharacter.click();
  } catch {
    // No Save Character button — auto-commit might have happened.
  }

  // Creation can render inline or in the sheet. If the sheet remains open,
  // try one visible commit action before failing.
  try {
    await expect(page.locator("#sheet-overlay")).not.toHaveClass(/is-open/, { timeout: 10000 });
  } catch {
    // Sheet still open — try clicking any available commit button.
    const anyBtn = page.locator("#sheet-card button").filter({ hasText: /lock|save|roll|confirm|create|start/i }).first();
    if (await anyBtn.isVisible().catch(() => false)) {
      await anyBtn.click();
      await page.waitForTimeout(1000);
    }
    await expect(page.locator("#sheet-overlay")).not.toHaveClass(/is-open/, { timeout: 10000 });
  }
}

export async function createPublicCharacter(page: Page, name: string) {
  const result = await page.evaluate(async (characterName) => {
    const postCommand = async (payload: Record<string, unknown>) => {
      const resp = await fetch("/api/apps/ruby-high/session/browser-smoke/command", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await resp.json();
      if (!resp.ok) {
        throw new Error(`command ${String(payload.type)} failed: ${JSON.stringify(body)}`);
      }
      return body;
    };
    await postCommand({ type: "clear-character" }).catch(() => null);
    await postCommand({
      type: "create-character",
      name: characterName,
      playbookId: "overachiever",
      stats: { head: 2, heart: 0, hustle: -1, honor: 1 },
      arcAnswer: "I want the whole room to learn together.",
      personality: "Curious, steady, and public-world ready.",
    });
    return await postCommand({ type: "set-public-presence", publicWorldVisible: true });
  }, name);
  return result;
}

/**
 * Click an enabled answer button (any choice) to submit an answer,
 * then wait for the board reveal to appear.
 */
export async function answerAnyQuestion(page: Page) {
  const answer = page.locator(".answer:not([disabled])").first();
  await expect(answer).toBeVisible({ timeout: 5000 });
  await answer.click();
  await expect(page.locator("#board-reveal")).toBeVisible({ timeout: 5000 });
}

/**
 * Close reward comic modals that can appear after a forced grade tick.
 */
export async function closeRewardComicIfVisible(page: Page) {
  const modal = page.locator(".comic-reader.is-reward").first();
  try {
    await expect(modal).toBeVisible({ timeout: 2000 });
    await modal.getByRole("button", { name: "Close comic page" }).click();
    await expect(modal).not.toBeVisible({ timeout: 5000 });
  } catch {
    // No reward modal appeared for this action.
  }
}

/**
 * Click the Continue/Chat button. Returns true if the click was handled
 * (some clicks are debounced or suppressed when no action is available).
 */
export async function clickContinue(page: Page) {
  const btn = page.locator("#next-btn");
  try {
    await expect(btn).toBeVisible({ timeout: 2000 });
    await btn.click();
    return true;
  } catch {
    return false;
  }
}

/**
 * Force-complete the current grade: creates passing daily class records,
 * sets the streak, and marks the grade ready for graduation.
 * Call this after answering questions for all needed classes, then reload.
 */
export async function tickGrade(page: Page) {
  const result = await page.evaluate(async () => {
    const resp = await fetch("/dev/tick-grade", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await resp.json();
    if (!resp.ok) {
      throw new Error(`tick-grade failed: ${JSON.stringify(body)}`);
    }
    return body;
  });
  return result;
}

export async function contributeLiveRoomGoalForDev(page: Page, faculty = "ruby") {
  const result = await page.evaluate(async (requestedFaculty) => {
    const resp = await fetch("/dev/contribute-live-room-goal", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faculty: requestedFaculty }),
    });
    const body = await resp.json();
    if (!resp.ok) {
      throw new Error(`dev live-room contribution failed: ${JSON.stringify(body)}`);
    }
    return body;
  }, faculty);
  return result;
}

/**
 * Pose and answer a real room question so live-room goal progress comes from
 * the same command route used by players.
 */
export async function answerLiveRoomQuestion(page: Page, faculty = "ruby") {
  const result = await page.evaluate(async (requestedFaculty) => {
    const postCommand = async (payload: Record<string, unknown>) => {
      const resp = await fetch("/api/apps/ruby-high/session/browser-smoke/command", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await resp.json();
      if (!resp.ok) {
        throw new Error(`command ${String(payload.type)} failed: ${JSON.stringify(body)}`);
      }
      return body;
    };
    const readSession = async () => {
      const resp = await fetch("/api/apps/ruby-high/session/browser-smoke", { credentials: "same-origin" });
      const body = await resp.json();
      if (!resp.ok) {
        throw new Error(`session read failed: ${JSON.stringify(body)}`);
      }
      return body;
    };

    const existing = await readSession();
    const telemetry = existing?.session?.telemetry;
    const liveRound = telemetry?.current && telemetry?.phase === "asking" && telemetry?.active_round && !telemetry.active_round.resolved && !telemetry.active_round.player?.isLocked;
    if (telemetry?.current && !liveRound) {
      await postCommand({ type: "clear" });
    }
    const picked = liveRound
      ? existing
      : await postCommand({ type: "pick", mode: "practice", faculty: requestedFaculty });
    const current = picked?.session?.telemetry?.current;
    if (!current) {
      throw new Error(`pick did not return a current question: ${JSON.stringify(picked)}`);
    }
    const answerPayload = current.type === "multiple-choice"
      ? { type: "answer", picked: "A" }
      : { type: "answer-text", answerText: "A focused smoke-test answer." };
    return await postCommand(answerPayload);
  }, faculty);
  return result;
}
