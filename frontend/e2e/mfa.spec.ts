// Two-factor sign-in through the browser: the administrator's code prompt, then a new staff
// account that turns on an authenticator app and signs in with it.
import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { adminEmail, adminPassword, adminSession, adminTotpSecret, call, freshTotp, totpAt } from "./support";

const run = randomBytes(3).toString("hex");

test("administrator: wrong code is refused, the right one signs in", async ({ page }) => {
  test.skip(!adminTotpSecret, "the administrator has no TOTP factor in E2E_ADMIN_FILE");
  await page.goto("/login");
  await page.getByLabel("Roll number or username").fill(adminEmail);
  await page.locator("#password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page.getByText(/two-factor sign-in for/i)).toBeVisible();
  await page.locator("#code").fill("000000");
  await page.getByRole("button", { name: /verify and sign in/i }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(/wrong or has expired/i);
  await expect(page).toHaveURL(/\/login/);

  await page.locator("#code").fill(await freshTotp(adminTotpSecret!));
  await page.getByRole("button", { name: /verify and sign in/i }).click();
  await page.waitForURL("**/admin");
});

test("a staff account enrols an authenticator and then needs it to sign in", async ({ browser }) => {
  // Setup through the API: a department user with a staff-issued password.
  const admin = await adminSession();
  const tenant = (await call<{ items: { id: string }[] }>("GET", "/tenant/v1/tenants", undefined, admin)).items[0]!.id;
  const department = (await call<{ items: { id: string }[] }>("GET", `/tenant/v1/tenants/${tenant}/departments`, undefined, admin)).items[0]!.id;
  const staff = await call<{ password: string }>("POST", `/user/v1/tenants/${tenant}/staff`, {
    username: `mfa.${run}`, display_name: "MFA Tester", role: "department_user", department_id: department,
  }, admin, 201);
  const username = `mfa.${run}`;
  const changed = `E2e-${run}-Changed1`;

  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByLabel("Roll number or username").fill(username);
  await page.locator("#password").fill(staff.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/account/password**");
  await page.getByLabel("Password you were given").fill(staff.password);
  await page.getByLabel("New password", { exact: true }).fill(changed);
  await page.getByLabel("New password again").fill(changed);
  await page.getByRole("button", { name: "Save password" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/account/password"));

  // Turn on the authenticator from the account menu's page.
  await page.goto("/account/security");
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  const secret = (await page.getByTestId("totp-secret").innerText()).trim();
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);

  await page.locator("#totp-code").fill("000000");
  await page.getByRole("button", { name: "Turn on two-factor sign-in" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(/wrong or has expired/i);

  await page.locator("#totp-code").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Turn on two-factor sign-in" }).click();
  const codes = page.getByTestId("recovery-codes").locator("li");
  await expect(codes.first()).toBeVisible();
  expect(await codes.count()).toBeGreaterThanOrEqual(8);
  const recovery = (await codes.first().innerText()).trim();

  // A fresh browser session now stops at the code prompt; a recovery code works once.
  const again = await (await browser.newContext()).newPage();
  await again.goto("/login");
  await again.getByLabel("Roll number or username").fill(username);
  await again.locator("#password").fill(changed);
  await again.getByRole("button", { name: /sign in/i }).click();
  await expect(again.getByText(/two-factor sign-in for/i)).toBeVisible();
  await again.locator("#code").fill(await freshTotp(secret));
  await again.getByRole("button", { name: /verify and sign in/i }).click();
  await again.waitForURL((url) => !url.pathname.startsWith("/login"));

  const viaRecovery = await (await browser.newContext()).newPage();
  await viaRecovery.goto("/login");
  await viaRecovery.getByLabel("Roll number or username").fill(username);
  await viaRecovery.locator("#password").fill(changed);
  await viaRecovery.getByRole("button", { name: /sign in/i }).click();
  await viaRecovery.locator("#code").fill(recovery);
  await viaRecovery.getByRole("button", { name: /verify and sign in/i }).click();
  await viaRecovery.waitForURL((url) => !url.pathname.startsWith("/login"));
  void totpAt;
});
