import { afterEach, expect, test, vi } from "vitest";
import { serverNow, syncServerClock } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("syncServerClock corrects a browser clock that is hours ahead", async () => {
  const server = Date.parse("2026-11-18T12:59:00Z");
  vi.stubGlobal("fetch", async () => new Response(null, { status: 204, headers: { Date: new Date(server).toUTCString() } }));
  vi.spyOn(Date, "now").mockReturnValue(server + 8 * 3600_000);
  expect(await syncServerClock()).toBe(true);
  expect(Math.abs(serverNow() - (server + 500))).toBeLessThan(1000);
});

test("syncServerClock ignores a failed request", async () => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline");
  });
  await expect(syncServerClock()).resolves.toBe(false);
});
