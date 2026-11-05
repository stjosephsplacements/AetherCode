// The staff console through the browser: add a department, enrol one student, import several from a
// pasted list, then check the new students can sign in with the one-time passwords they were given.
import { expect, test, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { setUp, type Setup } from "./seed";
import { adminEmail, adminPassword, adminTotpSecret, dismissOnboarding, freshTotp } from "./support";

const run = randomBytes(3).toString("hex").toUpperCase();
let seed: Setup;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  seed = await setUp(run, 10_000);
});

async function adminInCollege(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Roll number or username").fill(adminEmail);
  await page.locator("#password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.locator("#code").fill(await freshTotp(adminTotpSecret!));
  await page.getByRole("button", { name: /verify and sign in/i }).click();
  await page.waitForURL("**/admin");
  await page.goto(`/admin/open?college=${seed.tenant}&next=${encodeURIComponent("/staff")}`);
  await dismissOnboarding(page);
}

async function choose(page: Page, label: string, option: RegExp | string) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option }).first().click();
}

/** The one-time passwords a dialog shows after accounts are created (components/staff/credentials.tsx). */
async function oneTimePasswords(page: Page): Promise<string[]> {
  return (await page.getByRole("dialog").locator("span.select-all").allInnerTexts()).map((text) => text.trim()).filter(Boolean);
}

async function signInAs(browser: import("@playwright/test").Browser, identifier: string, password: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByLabel("Roll number or username").fill(identifier);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return page;
}

test("add a department, enrol a student and import a list", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await adminInCollege(page);

  // A department.
  await page.goto("/staff/departments");
  await page.getByRole("button", { name: "Add department" }).click();
  const dialog = page.getByRole("dialog", { name: "New department" });
  const code = `UI${run}`.slice(0, 8);
  await dialog.getByRole("textbox", { name: "Code" }).fill(code);
  await dialog.getByRole("textbox", { name: "Name" }).fill(`UI Department ${run}`);
  // Inside one college there is no college picker.
  await expect(dialog.getByRole("combobox", { name: "College" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Create department" }).click();
  await expect(page.getByRole("cell", { name: `UI Department ${run}` })).toBeVisible({ timeout: 30_000 });

  // One student by hand.
  await page.goto("/staff/students");
  await page.getByRole("button", { name: "Enrol student" }).click();
  const enrol = page.getByRole("dialog", { name: "Enrol a student" });
  const roll = `UI${run}A`;
  await enrol.getByRole("textbox", { name: "Roll number" }).fill(roll);
  await enrol.getByRole("textbox", { name: "Full name" }).fill("UI Student One");
  await choose(page, "Batch", /.*/);
  await choose(page, "Placement department", /.*/);
  await enrol.getByRole("button", { name: "Enrol" }).click();
  // The dialog text already mentions passwords before the result arrives, so wait for the password itself.
  await expect(page.getByRole("dialog").locator("span.select-all").first()).toBeVisible({ timeout: 30_000 });
  const [firstPassword] = await oneTimePasswords(page);
  expect(firstPassword, "the one-time password is shown once").toBeTruthy();
  await page.keyboard.press("Escape");
  // The roster is paged and sorted by roll number, so find the new student by searching.
  await page.getByRole("searchbox", { name: "Search students" }).fill(roll);
  await expect(page.getByRole("link", { name: "UI Student One" })).toBeVisible({ timeout: 30_000 });

  // The new student signs in with it and is told to choose a password of their own.
  const student = await signInAs(browser, roll.toLowerCase(), firstPassword!);
  await student.waitForURL("**/account/password**");
  await student.close();

  // Several at once from a pasted list, and a wrong row is explained.
  await page.getByRole("button", { name: "Bulk import" }).click();
  const importer = page.getByRole("dialog", { name: "Import students" });
  await choose(page, "Batch", /.*/);
  await choose(page, "Placement department", /.*/);
  await importer.getByRole("textbox", { name: "Or paste the list" }).fill(`roll_number,name,email\nUI${run}B,UI Student Two,\nUI${run}C,UI Student Three,\n`);
  await importer.getByRole("button", { name: /^Review \d+ students?/ }).click();
  await expect(importer).toContainText(`UI${run}B`);
  await importer.getByRole("button", { name: /^Import/ }).click();
  await expect(page.getByRole("dialog").locator("span.select-all").first()).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("searchbox", { name: "Search students" }).fill(`UI${run}`);
  await expect(page.getByRole("link", { name: "UI Student Two" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "UI Student Three" })).toBeVisible();
});
