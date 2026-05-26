import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
