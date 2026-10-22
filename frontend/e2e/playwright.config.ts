import { defineConfig } from "@playwright/test";

// Runs against a running platform: the frontend at E2E_BASE_URL and the
// gateway at E2E_GATEWAY_URL (see deploy/single-server/README.md, "End-to-end test").
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
