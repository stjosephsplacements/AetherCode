// An elevated staff action needs a recent MFA check. A college administrator without an authenticator is
// asked for a code (instead of seeing an internal marker), and the dialog explains when none is enrolled.
import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { setUp } from "./seed";
import { adminSession, call } from "./support";

const run = randomBytes(3).toString("hex").toLowerCase();

test("an elevated action asks for a code instead of failing", async ({ page }) => {
  test.setTimeout(300_000);
  const seed = await setUp(run.toUpperCase(), 10_000);
  const admin = await adminSession();
  const username = `stepup.${run}`;
  const staff = await call<{ password: string }>("POST", `/user/v1/tenants/${seed.tenant}/staff`, {
    username, display_name: "Step Up Tester", role: "college_admin",
  }, admin, 201);
  const chosen = `Su-${run}-Changed1x`;
  const pair = await call<{ access_token: string }>("POST", "/identity/v1/auth/login", { identifier: username, password: staff.password });
  await call("POST", "/identity/v1/auth/password", { current_password: staff.password, new_password: chosen }, pair.access_token, 204);

  await page.goto("/login");
  await page.getByLabel("Roll number or username").fill(username);
  await page.locator("#password").fill(chosen);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  await page.goto("/staff/accounts");
  await page.getByRole("button", { name: "Add staff" }).first().click();
  const form = page.getByRole("dialog", { name: "New staff account" });
  await form.getByRole("textbox", { name: "Full name" }).fill("Another Staff");
  await form.getByRole("textbox", { name: "Username" }).fill(`other.${run}`);
  await form.getByRole("combobox", { name: "Role" }).click();
  await page.getByRole("option", { name: "College administrator" }).click();
  await form.getByRole("button", { name: "Create account" }).click();

  const dialog = page.getByRole("dialog", { name: "Verify your identity" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("__mfa_required__")).toHaveCount(0);
  await dialog.getByLabel("Authenticator code").fill("000000");
  await dialog.getByRole("button", { name: "Verify" }).click();
  await expect(dialog.getByRole("alert")).toContainText(/No MFA factor is enrolled/i, { timeout: 30_000 });
});
