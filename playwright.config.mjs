import { defineConfig } from "@playwright/test";

const port = 8798;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.js",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    // Uses the Edge already installed on Windows. On CI: `npx playwright install chromium`
    // and set E2E_CHANNEL=chromium.
    channel: process.env.E2E_CHANNEL || "msedge",
  },
  // The real dev server, so the security headers, the CSP and the single-page-app
  // fallback are all exercised.
  webServer: {
    command: `npx wrangler dev --port ${port} --ip 127.0.0.1`,
    url: `http://127.0.0.1:${port}/logo.svg`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: "false" },
  },
});
