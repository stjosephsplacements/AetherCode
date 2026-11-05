// End to end through a real browser, the platform and the engine, as v1's
// e2e/exam-flow.spec.ts (M8). The college data is set up through the gateway
// like smoke.py (E2E_ADMIN_FILE holds "<email> <password>"); the browser then
// does what a student and a teacher do: forced password change, open and start
// the exam, a failing Run, a passing Submit, End test, release, and the score.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { setUp } from "./seed";
import { GATEWAY, adminEmail, adminPassword, adminTotpSecret, call, dismissOnboarding, freshTotp } from "./support";

const run = randomBytes(3).toString("hex").toUpperCase();
const CORRECT = "n = int(input())\nprint(n * (n + 1) // 2)\n";
const WRONG = "n = int(input())\nprint(n * n)\n";

/**
 * With E2E_UPSTREAM (such as http://127.0.0.1:8382), the browser keeps the
 * public origin, so secure cookies and the cross-site check behave as in
 * production, while each request is served by the frontend on this host.
 */
async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const upstream = process.env.E2E_UPSTREAM;
  if (upstream) {
    const origin = new URL(test.info().project.use.baseURL!).origin;
    await context.route(`${origin}/**`, async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: upstream + url.pathname + url.search, maxRedirects: 0,
        headers: { ...route.request().headers(), host: url.host, "x-forwarded-proto": "https" } });
      await route.fulfill({ response });
    });
  }
  return context.newPage();
}

async function signIn(browser: Browser, identifier: string, password: string, totpSecret?: string): Promise<Page> {
  const page = await newPage(browser);
  await page.goto("/login");
  await page.getByLabel("Roll number or username").fill(identifier);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  if (totpSecret) {
    await page.locator("#code").fill(await freshTotp(totpSecret));
    await page.getByRole("button", { name: /verify and sign in/i }).click();
  }
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return page;
}

/** Replaces the editor's code; insertText skips Monaco's auto-closing brackets. */
async function writeCode(page: Page, code: string) {
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(code);
}

test("password change → start → run/submit → end test → release → score", async ({ browser }) => {
  const setup = await setUp(run);

  // Student: a staff-issued password must be replaced first (ADR-0036).
  const student = await signIn(browser, setup.roll, setup.password);
  await student.waitForURL("**/account/password**");
  await student.getByLabel("Password you were given").fill(setup.password);
  await student.getByLabel("New password", { exact: true }).fill(`E2e-${run}-changed1`);
  await student.getByLabel("New password again").fill(`E2e-${run}-changed1`);
  await student.getByRole("button", { name: "Save password" }).click();
  await student.waitForURL((url) => !url.pathname.startsWith("/account/password"));

  // Student: open the exam once it opens and start it.
  await student.goto("/student");
  await expect(student.getByText(setup.title).first()).toBeVisible();
  // Listed under Upcoming until it opens; its link leads to the same exam page.
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
  await honor.getByRole("textbox").fill(setup.roll);
  await honor.getByRole("button", { name: /I agree, start the exam/ }).click();
  await student.waitForURL("**/student/attempts/**");

  // A wrong Run fails both samples; a correct Submit passes every test.
  await student.getByRole("combobox", { name: "Language" }).click();
  await student.getByRole("option", { name: "Python 3" }).click();
  await writeCode(student, WRONG);
  await student.getByRole("button", { name: "Run code" }).click();
  await expect(student.getByText("0 of 2 sample tests passed").first()).toBeVisible();
  await writeCode(student, CORRECT);
  await student.getByRole("button", { name: "Run code" }).click();
  await expect(student.getByText("All 2 sample tests passed").first()).toBeVisible();
  await student.getByRole("button", { name: "Submit code" }).click();
  await expect(student.getByText("All 4 test cases passed")).toBeVisible();

  await student.locator("header").getByRole("button", { name: "End test" }).click();
  await student.getByRole("alertdialog").getByRole("button", { name: "End test" }).click();
  await student.waitForURL("**/student/results/**");
  const resultURL = student.url();

  // A classmate in the same college cannot read this student's attempt, answers or result.
  const attemptId = new URL(resultURL).pathname.split("/").pop()!;
  const classmate = await call<{ access_token: string }>("POST", "/identity/v1/auth/login", { identifier: setup.roll2, password: setup.password2 });
  for (const path of ["", "/answers", "/result", "/review", "/paper"]) {
    const status = (await fetch(`${GATEWAY}/submission/v1/tenants/${setup.tenant}/attempts/${attemptId}${path}`, {
      headers: { Authorization: `Bearer ${classmate.access_token}` }, // lgtm[js/file-access-to-http]
    })).status;
    expect([401, 403, 404], `a classmate must not read attempts/${attemptId}${path} (got ${status})`).toContain(status);
  }
  const intruder = await signIn(browser, setup.roll2, setup.password2);
  await intruder.goto(resultURL);
  await expect(intruder.getByText("Your score")).toHaveCount(0);
  await intruder.close();

  // Teacher: release the results from the live monitor.
  const teacher = await signIn(browser, adminEmail, adminPassword, adminTotpSecret);
  teacher.on("dialog", (dialog) => void dialog.accept());
  // A platform administrator works in a college only after opening it (areas.spec.ts).
  await teacher.goto(`/admin/open?college=${setup.tenant}&next=${encodeURIComponent("/staff")}`);
  await dismissOnboarding(teacher);
  const release = teacher.getByRole("button", { name: "Release results" });
  await expect(async () => {
    await teacher.goto(`/staff/exams/${setup.examId}/monitor`);
    await expect(release).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
  await release.click();
  await expect(async () => {
    await teacher.reload();
    await expect(teacher.getByRole("button", { name: "Hide results" })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });

  // Student: the released score is full marks. The release reaches the student's read model
  // asynchronously, so poll and report how long it took.
  const released = Date.now();
  await expect
    .poll(async () => {
      await student.goto(resultURL);
      // The page streams in after load, so wait for the text instead of testing it at once.
      return student.getByText("Your score").waitFor({ state: "visible", timeout: 8_000 }).then(() => true, () => false);
    }, { timeout: 180_000, intervals: [1000] })
    .toBe(true);
  console.log(`results reached the student after ${Math.round((Date.now() - released) / 1000)} s`);
  await expect(student.getByText(/\b10\s*\/\s*10\b/).first()).toBeVisible();
});
