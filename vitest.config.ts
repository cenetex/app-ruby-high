import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Answer choices are shuffled per-pose in production (see
    // RubyHighService.shuffleQuestionChoices). Disable it under test so the
    // stored A/B/C/D order is deterministic; choice-shuffle.test.ts opts back
    // in to verify the behavior.
    env: {
      RUBY_HIGH_SHUFFLE_CHOICES: "0",
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
      "node_modules/**",
      "dist/**",
      "dist-spa/**",
      "tests/browser/**",
    ],
  }
});
