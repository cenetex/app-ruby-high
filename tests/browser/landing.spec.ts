import { expect, test } from "@playwright/test";

test("a campaign landing visit reaches class with its source and campaign", async ({ page }) => {
  const events: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/apps/ruby-high/metrics/event")) {
      const body = request.postDataJSON();
      if (body) events.push(body);
    }
  });
  await page.goto("/?ref=outreach-discord-v1&rh_source=discord&rh_campaign=outreach-v1&rh_landing=default&rh_entry=viewer");
  await page.getByRole("link", { name: "Start class", exact: true }).click();
  await expect.poll(() => events.find((event) => event.type === "app_open")).toMatchObject({
    campaignSource: "discord", campaignId: "outreach-v1", landingVariant: "default", entrypoint: "viewer",
  });
  await expect.poll(() => events.find((event) => event.type === "share_link_visited")).toMatchObject({ ref: "outreach-discord-v1" });
  await expect(page).not.toHaveURL(/[?&](ref|rh_source|rh_campaign)=/);
});

test("share kit selects channel copy and offers a manual copy fallback on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async () => { throw new Error("Clipboard unavailable"); },
    } });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/share");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bring a friend to class.");
  await page.getByLabel("Where are you sharing?").selectOption("hn");
  const message = page.getByLabel("Your invitation");
  await expect(message).toHaveValue(/https:\/\/ruby-high.ai\/api\/apps\/ruby-high\/viewer\?ref=outreach-hn-v1&rh_source=hn&rh_campaign=outreach-v1/);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Text selected. Use your device's Copy action.");
  expect(await message.evaluate((element) => {
    const field = element as HTMLTextAreaElement;
    return field.value.slice(field.selectionStart, field.selectionEnd);
  })).toBe(await page.getByRole("link", { name: "Preview the invitation link" }).getAttribute("href"));

  await page.getByLabel("Where are you sharing?").selectOption("partner");
  await expect(message).toHaveValue(/rh_source=partner.*#agents/);
  await expect(page.getByRole("status")).toBeEmpty();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("share kit copies the selected invitation and link", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/share");
  for (const channel of ["friend", "x", "discord", "telegram", "hn", "reddit", "partner"]) {
    await page.getByLabel("Where are you sharing?").selectOption(channel);
    const invitation = await page.getByLabel("Your invitation").inputValue();
    await page.getByRole("button", { name: "Copy invitation", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Invitation copied. Ready to share.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(invitation);
    const link = await page.getByRole("link", { name: "Preview the invitation link" }).getAttribute("href");
    expect(new URL(link!).searchParams.get("rh_source")).toBe(channel);
  }
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Link copied. Ready to share.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await page.getByRole("link", { name: "Preview the invitation link" }).getAttribute("href"));
});

test("campaign links and the default invitation work with scripts disabled", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(`${test.info().project.use.baseURL}/?ref=outreach-friend-v1&rh_source=friend&rh_campaign=outreach-v1`);
    await expect(page.getByRole("link", { name: "Start class", exact: true })).toHaveAttribute("href", /rh_source=friend&rh_campaign=outreach-v1/);
    await page.getByRole("link", { name: "Invite a friend", exact: true }).click();
    await expect(page.getByLabel("Your invitation")).toHaveValue(/outreach-friend-v1/);
    await expect(page.getByRole("link", { name: "Download school artwork" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy invitation", exact: true })).toBeHidden();
  } finally {
    await context.close();
  }
});
