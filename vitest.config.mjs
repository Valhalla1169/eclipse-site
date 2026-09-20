import { defineConfig } from "vitest/config";

// Only the unit tests. The browser tests in tests/e2e belong to Playwright.
export default defineConfig({
  test: { include: ["tests/unit/**/*.test.js"] },
});
