import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // This suite boots many stateful service instances that write temporary
    // JSON stores. Letting Vitest fan out across every local CPU has caused
    // fork startup timeouts and teardown/write races on busy machines, while
    // still passing when the same files are run focused. Keep enough
    // parallelism for feedback, but cap the worker pressure.
    maxWorkers: process.env.VITEST_MAX_WORKERS ?? 4,
    minWorkers: 1,
    // Answer choices are shuffled per-pose in production (see
    // RubyHighService.shuffleQuestionChoices). Disable it under test so the
    // stored A/B/C/D order is deterministic; choice-shuffle.test.ts opts back
    // in to verify the behavior.
    env: {
      RUBY_HIGH_SHUFFLE_CHOICES: "0",
      RUBY_HIGH_QUIET_LOGS: "1",
    },
    coverage: {
      provider: "v8",
      all: true,
      reportsDirectory: "coverage",
      reporter: ["text", "json-summary", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/__tests__/**",
        "src/**/*.d.ts"
      ]
    },
    exclude: [
      "**/node_modules/**",
      "packages/**",
      "dist/**",
      "dist-spa/**",
      "tests/browser/**",
      "tmp/**",
      ".tmp/**",
    ],
  }
});
