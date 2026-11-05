// A platform administrator lands in /admin, opens one college into /staff on purpose, and /placement is its own area.
import { expect, test } from "@playwright/test";
import { adminEmail, adminPassword, adminTotpSecret, dismissOnboarding, freshTotp } from "./support";

test("areas are separate", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Roll number or username").fill(adminEmail);
  await page.locator("#password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  if (adminTotpSecret) {
    await page.locator("#code").fill(await freshTotp(adminTotpSecret));
    await page.getByRole("button", { name: /verify and sign in/i }).click();
  }
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
  await dismissOnboarding(page);
  await expect(page.getByRole("link", { name: "Back to admin" }).first()).toBeVisible();
  // No all-colleges lists inside a college.
  await expect(page.getByRole("combobox", { name: "College" })).toHaveCount(0);
});
