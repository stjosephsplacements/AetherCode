import { defineConfig } from "@playwright/test";

// Runs against a local platform: the frontend at E2E_BASE_URL and the gateway
// at 127.0.0.1:8380. The gateway endpoint is intentionally fixed in the test.
export default defineConfig({
  testDir: ".",
  timeout: 300_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:8382",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
});
