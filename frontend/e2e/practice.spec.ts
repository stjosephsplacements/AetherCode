// A student practises a coding question in the browser: the question is moved to practice by staff,
// then the student runs it on the samples and submits it against every test.
import { expect, test, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { setUp } from "./seed";
import { adminSession, call } from "./support";

const run = randomBytes(3).toString("hex").toUpperCase();
const CORRECT = "n = int(input())\nprint(n * (n + 1) // 2)\n";
const WRONG = "n = int(input())\nprint(n * n)\n";

/** Replaces the editor's code; insertText skips Monaco's auto-closing brackets. */
async function writeCode(page: Page, code: string) {
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(code);
}

test("a student runs and submits a practice question", async ({ page }) => {
  test.setTimeout(300_000);
  const setup = await setUp(run, 3_600_000);
  const admin = await adminSession();
  await call("PUT", `/question-bank/v1/questions/${setup.questionId}/audience`, { audience: "practice" }, admin);

  await page.goto("/login");
  await page.getByLabel("Roll number or username").fill(setup.roll);
  await page.locator("#password").fill(setup.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/account/password**");
  const chosen = `Pr-${run}-Changed1x`;
  await page.getByLabel("Password you were given").fill(setup.password);
  await page.getByLabel("New password", { exact: true }).fill(chosen);
  await page.getByLabel("New password again").fill(chosen);
  await page.getByRole("button", { name: "Save password" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/account/password"));

  // The question is listed under Practice (the page offers "Solve it" links) and opens by its id.
  await page.goto("/student/practice");
  await expect(page.getByRole("link", { name: "Solve it" }).first()).toBeVisible();
  await page.goto(`/student/practice/${setup.questionId}`);
  await expect(page.getByText(setup.questionTitle).first()).toBeVisible();

  await page.getByRole("combobox", { name: "Language" }).click();
  await page.getByRole("option", { name: "Python 3" }).click();

  // A wrong program fails the samples; a right one passes them and then every test.
  await writeCode(page, WRONG);
  await page.getByRole("button", { name: /^Run/ }).first().click();
  await expect(page.getByText("Wrong answer").first()).toBeVisible({ timeout: 90_000 });
  await writeCode(page, CORRECT);
  await page.getByRole("button", { name: /^Run/ }).first().click();
  await expect(page.getByText(/^Passed/).first()).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: /^Submit/ }).first().click();
  await page.getByRole("tab", { name: "Submissions" }).click();
  await expect(page.getByText(/Accepted/i).first()).toBeVisible({ timeout: 90_000 });

  // The student's own progress shows it, and a hidden test's input or output is never shown.
  await expect(page.getByText("1000000")).toHaveCount(0);
  await expect(page.getByText("500000500000")).toHaveCount(0);
});
