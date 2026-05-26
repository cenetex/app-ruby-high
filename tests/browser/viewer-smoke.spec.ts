import { expect, type Page, test } from "@playwright/test";

const PRIVY_CLIENT_STUB = `
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

function watchRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  return errors;
}

async function stubPrivyBundle(page: Page): Promise<() => number> {
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

async function openViewer(page: Page) {
  const errors = watchRuntimeErrors(page);
  const privyRequests = await stubPrivyBundle(page);
  await page.goto("/api/apps/ruby-high/viewer");
  await expect(page).toHaveTitle(/Ruby High/);
  await expect(page.locator("#shell")).toBeVisible();
  await expect(page.locator("#signin-overlay")).not.toHaveClass(/is-open/);
  await expect.poll(async () => (await page.locator("#you-state").textContent()) ?? "")
    .not.toMatch(/checking/i);
  await expect.poll(privyRequests).toBeGreaterThan(0);
  return { errors };
}

test("boots as a guest, creates a character, answers a card, and opens account tabs", async ({ page }) => {
  const { errors } = await openViewer(page);

  await expect(page.locator("#sheet-overlay")).toHaveClass(/is-open/);
  const lockButton = page.locator("#sheet-card").getByRole("button", { name: "Lock it in" });
  await expect(lockButton).toBeEnabled();
  await lockButton.click();

  await expect(page.locator("#sheet-overlay")).not.toHaveClass(/is-open/);
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
