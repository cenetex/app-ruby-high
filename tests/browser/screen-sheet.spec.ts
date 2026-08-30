import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  closeFirstBellReportIfVisible,
  closeRewardComicIfVisible,
  openViewer,
  tickGrade,
} from "./helpers.js";

const CAPTURE_VIEWPORT = { width: 480, height: 800 };
const OUTPUT_ROOT = path.resolve(
  process.env.RUBY_HIGH_SCREEN_SHEET_DIR || "test-outputs/ruby-high-screen-sheet",
);
const SCREENS_ROOT = path.join(OUTPUT_ROOT, "screens");
const SHEET_PATH = path.join(OUTPUT_ROOT, "ruby-high-app-screen-sheet.png");

type ScreenCapture = {
  id: string;
  title: string;
  group: string;
  stub?: boolean;
  path: string;
};

function safeFileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function freezeMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }
    `,
  });
}

async function dismissAnnouncementsWithoutOpeningCreator(page: Page): Promise<void> {
  const announcements = page.locator("#announcements-overlay");
  if (await announcements.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(announcements).not.toBeVisible();
  }
}

async function openNavigation(page: Page): Promise<void> {
  const shell = page.locator("#shell");
  if (!(await shell.evaluate((element) => element.classList.contains("is-rails-open")))) {
    await page.locator("#hamburger").click();
  }
  await expect(shell).toHaveClass(/is-rails-open/);
}

async function closeNavigation(page: Page): Promise<void> {
  const shell = page.locator("#shell");
  if (await shell.evaluate((element) => element.classList.contains("is-rails-open"))) {
    // The rail can retain its open class while another modal restores focus.
    // A DOM click keeps this cleanup deterministic even if the close icon has
    // just moved outside the small capture viewport.
    await page.locator("#channels-close").evaluate((element) => (element as HTMLElement).click());
  }
  await expect(shell).not.toHaveClass(/is-rails-open/);
}

async function closeStudentSheet(page: Page): Promise<void> {
  const sheet = page.locator("#sheet-overlay");
  if (await sheet.evaluate((element) => element.classList.contains("is-open"))) {
    await page.locator("#sheet-close").click();
  }
  await expect(sheet).not.toHaveClass(/is-open/);
}

async function closeAccount(page: Page): Promise<void> {
  const account = page.locator("#privy-overlay");
  if (await account.evaluate((element) => element.classList.contains("is-open"))) {
    await page.locator("#privy-close").click();
  }
  await expect(account).not.toHaveClass(/is-open/);
}

async function completeResponseBuilder(page: Page): Promise<void> {
  for (const group of ["claim", "stance", "evidence", "impact"]) {
    await page.locator(`[data-response-group="${group}"] [data-response-card]`).first().click();
  }
  await expect(page.locator("#typed-submit-btn")).toBeEnabled();
}

async function showExternalPreview(
  page: Page,
  kind: "signin" | "wallet" | "checkout",
): Promise<void> {
  await page.evaluate((previewKind) => {
    document.getElementById("screen-sheet-external-preview")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "screen-sheet-external-preview";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:999999",
      "display:grid",
      "place-items:center",
      "padding:20px",
      "background:rgba(3,7,16,.78)",
      "backdrop-filter:blur(8px)",
      "font-family:Inter,ui-sans-serif,system-ui,sans-serif",
      "color:#f4f5f8",
    ].join(";");

    const card = document.createElement("section");
    card.style.cssText = [
      "width:min(360px,calc(100vw - 40px))",
      "box-sizing:border-box",
      "padding:24px",
      "border:1px solid #2b3347",
      "border-radius:22px",
      "background:#080d1b",
      "box-shadow:0 24px 80px rgba(0,0,0,.55)",
    ].join(";");

    const button = (label: string, primary = false) => `
      <button type="button" style="width:100%;height:50px;margin-top:10px;padding:0 14px;border:1px solid ${primary ? "#cf403b" : "#30384c"};border-radius:12px;background:${primary ? "#cf403b" : "#0d1323"};color:#f4f5f8;text-align:left;font:600 14px Inter,system-ui,sans-serif;">${label}</button>`;
    const previewNote = "<div style=\"margin-top:18px;color:#7f8aa3;font-size:11px;text-align:center;letter-spacing:.08em;text-transform:uppercase;\">Safe test preview · no external action</div>";

    if (previewKind === "signin") {
      card.innerHTML = `
        <div style="font-size:22px;font-weight:750;text-align:center;margin:8px 0 20px;">Log in or sign up</div>
        <div style="display:flex;height:50px;border:1px solid #30384c;border-radius:12px;overflow:hidden;background:#0d1323;">
          <span style="display:grid;place-items:center;width:46px;color:#9aa5bc;">✉</span>
          <span style="display:flex;align-items:center;flex:1;color:#9aa5bc;font-size:14px;">your@email.com</span>
          <span style="display:flex;align-items:center;padding:0 14px;color:#626d83;font-size:13px;">Submit</span>
        </div>
        ${button("G  Continue with Google")}
        ${button("𝕏  Continue with X")}
        ${button("▣  Continue with a wallet")}
        <div style="margin-top:26px;color:#d56b6b;text-align:center;font-size:13px;">I have a passkey</div>
        <div style="margin-top:32px;color:#7f8aa3;text-align:center;font-size:13px;">Protected by Privy</div>
        ${previewNote}`;
    } else if (previewKind === "wallet") {
      card.innerHTML = `
        <div style="font-size:12px;color:#7f8aa3;letter-spacing:.12em;text-transform:uppercase;">Wallet connection</div>
        <div style="font-size:22px;font-weight:750;margin:8px 0 8px;">Choose a Solana wallet</div>
        <div style="color:#9aa5bc;font-size:14px;line-height:1.5;margin-bottom:12px;">Connect a wallet to hold collectible cards or exchange one for Hall Passes.</div>
        ${button("◉  Phantom")}
        ${button("◈  Solflare")}
        ${button("＋  Another wallet")}
        ${previewNote}`;
    } else {
      card.innerHTML = `
        <div style="font-size:12px;color:#7f8aa3;letter-spacing:.12em;text-transform:uppercase;">Checkout preview</div>
        <div style="font-size:22px;font-weight:750;margin:8px 0 18px;">Confirm Hall Pass purchase</div>
        <div style="padding:16px;border:1px solid #30384c;border-radius:14px;background:#0d1323;">
          <div style="display:flex;justify-content:space-between;font-weight:700;"><span>20 Hall Passes</span><span>$6.99</span></div>
          <div style="margin-top:8px;color:#9aa5bc;font-size:13px;line-height:1.45;">For portraits, extra students, course publishing, and collectible actions.</div>
        </div>
        ${button("Pay $6.99", true)}
        ${button("Cancel")}
        ${previewNote}`;
    }

    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }, kind);
  await expect(page.locator("#screen-sheet-external-preview")).toBeVisible();
}

async function hideExternalPreview(page: Page): Promise<void> {
  await page.evaluate(() => document.getElementById("screen-sheet-external-preview")?.remove());
}

async function showSeededComicReward(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelector(".comic-reader.is-screen-sheet-seed")?.remove();
    const overlay = document.createElement("div");
    overlay.className = "comic-reader is-reward is-screen-sheet-seed";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Comic page unlocked");
    overlay.innerHTML = `
      <div class="comic-reader-panel">
        <div class="comic-reader-top">
          <div class="comic-reader-title">Comic Page Unlocked <div class="comic-reader-detail">Ruby High: Book One - First Bell</div></div>
          <button class="comic-reader-close" type="button" aria-label="Close comic page">X</button>
        </div>
        <img alt="Ruby High: Book One - First Bell" src="/api/apps/ruby-high/assets/comics/first-bell/page-01.jpg">
      </div>`;
    overlay.querySelector("button")?.addEventListener("click", () => overlay.remove());
    document.body.appendChild(overlay);
  });
  await expect(page.locator(".comic-reader.is-screen-sheet-seed img")).toBeVisible();
}

async function buildContactSheet(captures: ScreenCapture[]): Promise<void> {
  const cards = await Promise.all(captures.map(async (capture, index) => {
    const image = await readFile(capture.path);
    const badge = capture.stub ? '<span class="stub">Stubbed state</span>' : "";
    return `
      <article>
        <header>
          <span class="number">${String(index + 1).padStart(2, "0")}</span>
          <span class="title">${escapeHtml(capture.title)}</span>
          ${badge}
        </header>
        <img alt="${escapeHtml(capture.title)}" src="data:image/png;base64,${image.toString("base64")}">
        <footer>${escapeHtml(capture.group)}</footer>
      </article>`;
  }));

  const html = `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Ruby High app screen sheet</title>
      <style>
        * { box-sizing: border-box; }
        html { background: #090c14; }
        body { margin: 0; padding: 42px; color: #f4f5f8; background: radial-gradient(circle at 15% 0%, #24151e 0, #10131d 28%, #090c14 70%); font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
        .sheet-head { display: flex; align-items: end; justify-content: space-between; gap: 24px; margin: 0 0 28px; }
        h1 { margin: 0; font-size: 38px; line-height: 1; letter-spacing: -.04em; }
        .meta { color: #9aa4b8; font-size: 14px; text-align: right; }
        main { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 22px; }
        article { overflow: hidden; border: 1px solid #303649; border-radius: 16px; background: #151927; box-shadow: 0 16px 38px rgba(0,0,0,.28); }
        article header { min-height: 58px; display: flex; align-items: center; gap: 10px; padding: 12px 14px; }
        .number { display: grid; place-items: center; flex: 0 0 30px; height: 30px; border-radius: 50%; background: #cf403b; color: white; font-size: 12px; font-weight: 800; }
        .title { min-width: 0; flex: 1; font-size: 14px; font-weight: 750; line-height: 1.2; }
        .stub { flex: 0 0 auto; padding: 4px 7px; border: 1px solid #7a65d1; border-radius: 999px; color: #c6baff; font-size: 9px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
        img { display: block; width: 100%; aspect-ratio: 3 / 5; object-fit: cover; object-position: top center; background: #080b12; }
        article footer { padding: 10px 14px 12px; color: #8f99ad; font-size: 10px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
      </style>
    </head>
    <body>
      <div class="sheet-head">
        <h1>Ruby High · app screens</h1>
        <div class="meta">${captures.length} states · ${CAPTURE_VIEWPORT.width} × ${CAPTURE_VIEWPORT.height} source captures<br>Generated by the browser screen-sheet test</div>
      </div>
      <main>${cards.join("\n")}</main>
    </body>
  </html>`;

  await writeFile(path.join(OUTPUT_ROOT, "index.html"), html, "utf8");
  await writeFile(path.join(OUTPUT_ROOT, "manifest.json"), JSON.stringify(
    captures.map(({ id, title, group, stub, path: capturePath }) => ({
      id,
      title,
      group,
      stub: !!stub,
      file: path.relative(OUTPUT_ROOT, capturePath),
    })),
    null,
    2,
  ) + "\n", "utf8");
}

test("generates the complete Ruby High app screen sheet", async ({ page }) => {
  test.setTimeout(240_000);
  await mkdir(SCREENS_ROOT, { recursive: true });
  await page.setViewportSize(CAPTURE_VIEWPORT);

  const captures: ScreenCapture[] = [];
  const capture = async (title: string, group: string, stub = false): Promise<void> => {
    const id = String(captures.length + 1).padStart(2, "0") + "-" + safeFileName(title);
    const capturePath = path.join(SCREENS_ROOT, id + ".png");
    await page.screenshot({ path: capturePath, animations: "disabled" });
    captures.push({ id, title, group, stub, path: capturePath });
    console.log(`captured ${id}`);
  };

  await openViewer(page);
  await freezeMotion(page);
  await expect(page.locator("#announcements-overlay")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Create my student" })).toBeVisible();
  await capture("Welcome", "Entry");

  await page.getByRole("button", { name: "Create my student" }).click();
  await expect(page.locator("#sheet-overlay")).toHaveClass(/is-open/);
  await expect(page.getByRole("button", { name: /start first class/i })).toBeEnabled();
  await capture("Student creator", "Entry");

  await page.getByRole("button", { name: /start first class/i }).click();
  await expect(page.locator("#sheet-overlay")).not.toHaveClass(/is-open/);
  await expect(page.locator(".answer:not([disabled])").first()).toBeVisible({ timeout: 15_000 });
  await capture("First classroom", "School");

  await openNavigation(page);
  await capture("School navigation", "School");

  const dailyFacultyId = await page.evaluate(async () => {
    const response = await fetch("/api/apps/ruby-high/session/browser-smoke", {
      credentials: "same-origin",
    });
    const session = await response.json();
    return String(session?.telemetry?.guest_access?.dailyFacultyId || "ruby");
  });
  const dailyRoom = page.locator(
    `.room-row-group[data-faculty="${dailyFacultyId}"] .room-row-button`,
  );
  if (await dailyRoom.isVisible().catch(() => false)) {
    const dailyRoomName = String(
      await dailyRoom.locator(".room-row-name").textContent() || "classroom",
    );
    await dailyRoom.click();
    await expect(page.locator("#channel-title")).toHaveText(dailyRoomName);
    await capture("Today's classroom", "School");
  }

  await openNavigation(page);
  await page.locator(".teacher-profile-button").first().click();
  await expect(page.locator("#sheet-overlay")).toHaveClass(/is-open/);
  await capture("Teacher card", "School");
  await closeStudentSheet(page);

  await openNavigation(page);
  await page.locator("#you-profile").click();
  await expect(page.locator("#sheet-overlay")).toHaveClass(/is-open/);
  await capture("Student card", "School");
  await closeStudentSheet(page);

  await openNavigation(page);
  await page.locator("#privy-action").click();
  await expect(page.locator("#privy-overlay")).toHaveClass(/is-open/);
  await capture("Account overview", "Account");

  for (const tab of [
    ["wallet", "Account passes"],
    ["library", "Account library"],
  ] as const) {
    await page.locator(`#account-tab-${tab[0]}`).click();
    await expect(page.locator(`#account-panel-${tab[0]}`)).toBeVisible();
    await capture(tab[1], "Account");
  }

  await page.locator("#account-tab-account").click();
  await showExternalPreview(page, "signin");
  await capture("Sign in", "External preview", true);
  await hideExternalPreview(page);
  await showExternalPreview(page, "wallet");
  await capture("Connect wallet", "External preview", true);
  await hideExternalPreview(page);

  await page.locator("#account-tab-wallet").click();
  await page.locator("#account-buy-passes").click();
  await expect(page.locator("#billing-overlay")).toHaveClass(/is-open/);
  const welcomePasses = page.locator(".welcome-hall-pass-popup");
  const welcomePassesOpened = await expect(welcomePasses)
    .toBeVisible({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (welcomePassesOpened) {
    await capture("Starter Hall Passes", "Hall Passes");
    await welcomePasses.locator("button").last().click();
    await expect(welcomePasses).not.toBeVisible();
  }
  await expect(page.locator("#billing-overlay")).toHaveClass(/is-open/);
  await capture("Hall Pass store", "Hall Passes");
  await showExternalPreview(page, "checkout");
  await capture("Checkout confirmation", "External preview", true);
  await hideExternalPreview(page);
  await page.locator("#billing-close").click();
  await expect(page.locator("#billing-overlay")).not.toHaveClass(/is-open/);
  await closeAccount(page);

  await closeNavigation(page);
  await openNavigation(page);
  const homeroom = page.getByRole("button", { name: /open homeroom classroom/i });
  if (await homeroom.isVisible().catch(() => false)) await homeroom.click();
  await closeNavigation(page);
  await expect(page.locator(".answer:not([disabled])").first()).toBeVisible({ timeout: 15_000 });

  await page.locator(".answer:not([disabled])").first().click();
  await expect(page.locator(".first-bell-overlay")).toBeVisible();
  await capture("First Bell report", "Class journey");
  await closeFirstBellReportIfVisible(page);
  await expect(page.locator("#board-reveal")).toBeVisible();
  await capture("Answer feedback", "Class journey");

  let comicCaptured = false;
  const captureComicIfVisible = async (): Promise<boolean> => {
    const comic = page.locator(".comic-reader.is-reward").first();
    if (!(await comic.isVisible({ timeout: 1_200 }).catch(() => false))) return false;
    if (!comicCaptured) {
      await capture("Comic page unlocked", "Class journey");
      comicCaptured = true;
    }
    await closeRewardComicIfVisible(page);
    return true;
  };

  const continueUntil = async (target: Locator): Promise<void> => {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await captureComicIfVisible();
      await closeFirstBellReportIfVisible(page);
      const targetReady = await target.isVisible().catch(() => false);
      const revealVisible = await page.locator("#board-reveal").isVisible().catch(() => false);
      if (targetReady && !revealVisible) return;
      const next = page.locator("#next-btn");
      if (await next.isVisible().catch(() => false) && await next.isEnabled().catch(() => false)) {
        await next.click();
      }
      await page.waitForTimeout(500);
    }
    await expect(target).toBeVisible();
    await expect(page.locator("#board-reveal")).toBeHidden();
  };

  await continueUntil(page.locator(".answer:not([disabled])").first());
  await capture("Second question", "Class journey");
  await page.locator(".answer:not([disabled])").first().click();
  await expect(page.locator("#board-reveal")).toBeVisible();
  await capture("Second answer feedback", "Class journey");

  if (!comicCaptured) {
    await showSeededComicReward(page);
    await capture("Comic page unlocked", "Class journey", true);
    comicCaptured = true;
    await page.locator(".comic-reader.is-screen-sheet-seed .comic-reader-close").click();
  }

  await continueUntil(page.locator("#response-builder"));
  await capture("Response builder", "Class journey");
  await completeResponseBuilder(page);
  await capture("Constructed response", "Class journey");
  await page.locator("#typed-submit-btn").click();
  await expect(page.locator("#board-reveal")).toBeVisible({ timeout: 15_000 });
  await capture("Response build feedback", "Class journey");

  await continueUntil(page.locator(".class-report-card"));
  await captureComicIfVisible();
  await expect(page.locator(".class-report-card")).toBeVisible();
  await capture("Class result and guest limit", "Class journey");

  await openNavigation(page);
  const classmate = page.locator(".student-row").first();
  if (await classmate.isVisible().catch(() => false)) {
    await classmate.click();
    await expect(page.locator("#sheet-overlay")).toHaveClass(/is-open/);
    await capture("Classmate card", "Progress");
    await closeStudentSheet(page);
  }

  await openNavigation(page);
  await page.locator("#you-profile").click();
  await expect(page.locator("#sheet-overlay")).toHaveClass(/is-open/);
  await capture("Student progress", "Progress");
  await expect(page.locator(".mash-grid-wrap")).toBeVisible();
  await page.locator(".mash-grid-wrap").scrollIntoViewIfNeeded();
  await capture("Social Card", "Progress");
  await closeStudentSheet(page);

  await tickGrade(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#shell")).toBeVisible();
  await expect(page.locator("#you-state")).not.toHaveText(/checking/i, { timeout: 15_000 });
  await freezeMotion(page);
  await dismissAnnouncementsWithoutOpeningCreator(page);
  await closeRewardComicIfVisible(page);

  await openNavigation(page);
  await page.locator("#you-profile").click();
  await expect(page.locator("#sheet-overlay")).toHaveClass(/is-open/);
  await expect(page.locator(".paper-archive-summary")).toBeVisible();
  await capture("Grade advance", "Progress");
  await page.locator(".paper-archive-summary").click();
  await expect(page.locator(".paper-archive")).toHaveAttribute("open", "");
  await capture("Yearbook", "Progress");
  await closeStudentSheet(page);

  await openNavigation(page);
  await page.locator("#honor-roll-button").click();
  await expect(page.locator("#leaderboard-panel")).toBeVisible();
  await expect(page.locator("#leaderboard-body")).not.toContainText("Loading…");
  await capture("Honor Roll", "Progress");

  expect(captures.length).toBeGreaterThanOrEqual(28);
  await buildContactSheet(captures);

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.setContent(await readFile(path.join(OUTPUT_ROOT, "index.html"), "utf8"), { waitUntil: "load" });
  await expect(page.locator("article")).toHaveCount(captures.length);
  await page.screenshot({ path: SHEET_PATH, fullPage: true, animations: "disabled" });

  console.log(`Ruby High screen sheet: ${SHEET_PATH}`);
});
