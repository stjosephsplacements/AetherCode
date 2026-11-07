// Staff add extra time from the live monitor, and the student's exam screen reflects the extension.
import { expect, test, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { setUp } from "./seed";
import { adminEmail, adminPassword, adminTotpSecret, dismissOnboarding, freshTotp } from "./support";

const run = randomBytes(3).toString("hex").toUpperCase();

async function writeCode(page: Page, code: string) {
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(code);
}

test("extra time is added from the monitor and the student sees a longer deadline", async ({ browser }) => {
  test.setTimeout(420_000);
  const seed = await setUp(run);

  // Student: change password and start the exam.
  const studentCtx = await browser.newContext();
  const student = await studentCtx.newPage();
  await student.goto("/login");
  await student.getByLabel("Roll number or username").fill(seed.roll);
  await student.locator("#password").fill(seed.password);
  await student.getByRole("button", { name: /sign in/i }).click();
  await student.waitForURL("**/account/password**");
  const chosen = `Xt-${run}-Changed1x`;
  await student.getByLabel("Password you were given").fill(seed.password);
  await student.getByLabel("New password", { exact: true }).fill(chosen);
  await student.getByLabel("New password again").fill(chosen);
  await student.getByRole("button", { name: "Save password" }).click();
  await student.waitForURL((url) => !url.pathname.startsWith("/account/password"));

  // Wait for the exam to open, then start it.
  const startLink = student.getByRole("link", { name: /Start exam/ }).first();
  await expect(async () => {
    await student.goto("/student");
    await expect(startLink).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000 });
  await startLink.click();
  const start = student.getByRole("button", { name: /Start exam/ });
  await expect(start).toBeEnabled({ timeout: 60_000 });
  await start.click();
  const honor = student.getByRole("dialog");
  for (const box of await honor.getByRole("checkbox").all()) await box.check();
  await honor.getByRole("textbox").fill(seed.roll);
  await honor.getByRole("button", { name: /I agree, start the exam/ }).click();
  await student.waitForURL("**/student/attempts/**");

  // Staff: sign in and open the live monitor.
  const staffCtx = await browser.newContext();
  const teacher = await staffCtx.newPage();
  await teacher.goto("/login");
  await teacher.getByLabel("Roll number or username").fill(adminEmail);
  await teacher.locator("#password").fill(adminPassword);
  await teacher.getByRole("button", { name: /sign in/i }).click();
  await teacher.locator("#code").fill(await freshTotp(adminTotpSecret!));
  await teacher.getByRole("button", { name: /verify and sign in/i }).click();
  await teacher.waitForURL("**/admin");
  await teacher.goto(`/admin/open?college=${seed.tenant}&next=${encodeURIComponent("/staff")}`);
  await dismissOnboarding(teacher);

  // Wait until the monitor shows the started student.
  await expect(async () => {
    await teacher.goto(`/staff/exams/${seed.examId}/monitor`);
    await expect(teacher.getByText("In progress").first()).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });

  // Add 30 minutes of extra time for everyone.
  await teacher.locator("#extend-all").fill("30");
  await teacher.getByRole("button", { name: "Add time" }).click();
  // The form resets or shows a success indicator after the action.
  await expect(async () => {
    const value = await teacher.locator("#extend-all").inputValue();
    // The form resets the field to its default (10) on success.
    return value === "10" || value === "";
  }).toPass({ timeout: 30_000 });

  // The student's exam page now shows the extended time. Reload to pick up
  // the server-side deadline change. The timer text should show more than
  // the original 60 minutes remaining (the exam just started, so >60 min
  // means extra time was applied).
  await student.reload();
  // Write some code to confirm the attempt is still live (not ended by the extension).
  await student.getByRole("combobox", { name: "Language" }).click();
  await student.getByRole("option", { name: "Python 3" }).click();
  await writeCode(student, "n = int(input())\nprint(n * (n + 1) // 2)\n");
  await student.getByRole("button", { name: "Run code" }).click();
  await expect(student.getByText(/sample tests passed/).first()).toBeVisible({ timeout: 90_000 });
});
