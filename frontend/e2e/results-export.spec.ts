// Staff export a results CSV after a student has taken and been graded on the exam.
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

test("results CSV contains the graded student's roll number and score", async ({ browser }) => {
  test.setTimeout(420_000);
  const seed = await setUp(run);

  // Student: change password, wait for the exam to open, start it.
  const studentCtx = await browser.newContext();
  const student = await studentCtx.newPage();
  await student.goto("/login");
  await student.getByLabel("Roll number or username").fill(seed.roll);
  await student.locator("#password").fill(seed.password);
  await student.getByRole("button", { name: /sign in/i }).click();
  await student.waitForURL("**/account/password**");
  await student.getByLabel("Password you were given").fill(seed.password);
  await student.getByLabel("New password", { exact: true }).fill(`Re-${run}-Changed1x`);
  await student.getByLabel("New password again").fill(`Re-${run}-Changed1x`);
  await student.getByRole("button", { name: "Save password" }).click();
  await student.waitForURL((url) => !url.pathname.startsWith("/account/password"));

  const startLink = student.getByRole("link", { name: /Start exam/ }).first();
  await expect(async () => {
    await student.goto("/student");
    await expect(startLink).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000 });
  await startLink.click();
  await expect(student.getByRole("button", { name: /Start exam/ })).toBeEnabled({ timeout: 60_000 });
  await student.getByRole("button", { name: /Start exam/ }).click();
  const honor = student.getByRole("dialog");
  for (const box of await honor.getByRole("checkbox").all()) await box.check();
  await honor.getByRole("textbox").fill(seed.roll);
  await honor.getByRole("button", { name: /I agree, start the exam/ }).click();
  await student.waitForURL("**/student/attempts/**");

  // Submit the correct solution.
  await student.getByRole("combobox", { name: "Language" }).click();
  await student.getByRole("option", { name: "Python 3" }).click();
  await writeCode(student, "n = int(input())\nprint(n * (n + 1) // 2)\n");
  await student.getByRole("button", { name: "Submit code" }).click();
  await expect(student.getByText("All 4 test cases passed")).toBeVisible({ timeout: 120_000 });

  // End the test.
  await student.locator("header").getByRole("button", { name: "End test" }).click();
  await student.getByRole("alertdialog").getByRole("button", { name: "End test" }).click();
  await student.waitForURL("**/student/results/**");
  await student.close();

  // Staff: sign in and go to the results page.
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

  // Wait for the graded result to appear on the results page.
  const resultsUrl = `/staff/exams/${seed.examId}/results`;
  await expect(async () => {
    await teacher.goto(resultsUrl);
    await expect(teacher.getByRole("button", { name: "Export CSV" })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 120_000 });

  // Click the export button and capture the download.
  const download = teacher.waitForEvent("download", { timeout: 30_000 });
  await teacher.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/results\.csv$/i);

  const text = (await import("node:fs")).readFileSync(await file.path(), "utf8");
  expect(text).toContain("roll_number");
  expect(text).toContain(seed.roll);
  // The student got full marks (10/10) from the correct solution.
  expect(text).toContain("10");
});
