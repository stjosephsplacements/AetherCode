// A platform administrator lands in /admin, opens one college into /staff on purpose, and /placement is its own area.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const [adminEmail, adminPassword] = readFileSync(process.env.E2E_ADMIN_FILE ?? `${homedir()}/aethercode-admin.txt`, "utf8").trim().split(/\s+/);

test("areas are separate", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Roll number or username").fill(adminEmail!);
  await page.locator("#password").fill(adminPassword!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/admin");

  // /staff is one college: without an opened college it sends a platform administrator back to /admin.
  await page.goto("/staff");
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/staff/placements");
  await expect(page).toHaveURL(/\/placement$/);
  await expect(page.getByRole("heading", { name: "Placements", level: 1 })).toBeVisible();

  await page.goto("/admin");
  await page.getByRole("link", { name: /Open workspace/ }).first().click();
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByRole("link", { name: "Back to admin" }).first()).toBeVisible();
  // No all-colleges lists inside a college.
  await expect(page.getByRole("combobox", { name: "College" })).toHaveCount(0);
});
