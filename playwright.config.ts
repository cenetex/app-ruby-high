import { defineConfig, devices } from "@playwright/test";

const host = "localhost";
const bindHost = "127.0.0.1";
const port = Number(process.env.RUBY_HIGH_BROWSER_PORT ?? 3100);
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/+$/, "");
const baseURL = externalBaseURL ?? `http://${host}:${port}`;

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60_000,
  workers: 1,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: externalBaseURL ? undefined : {
    command: [
      "rm -rf .tmp/playwright",
      "mkdir -p .tmp/playwright",
      "npm run build",
      [
        `PORT=${port}`,
        `HOST=${bindHost}`,
        `RUBY_HIGH_PUBLIC_BASE=${baseURL}`,
        "RUBY_HIGH_STATE_PATH=.tmp/playwright/state.json",
        "RUBY_HIGH_BUILD=playwright",
        "RUBY_HIGH_PRIVY_APP_ID=privy-app-smoke",
        "RUBY_HIGH_PRIVY_CLIENT_ID=privy-client-smoke",
        "RUBY_HIGH_PRIVY_LOGIN_METHODS=wallet",
        "node scripts/dev-server.mjs",
      ].join(" "),
    ].join(" && "),
    url: `${baseURL}/health`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
