import { defineConfig } from "@playwright/test";

// Runs against an already-running app + worker + engine (see README "End-to-end test").
export default defineConfig({
  testDir: ".",
  timeout: 300_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: process.env.E2E_BROWSER_CHANNEL || undefined,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
});
