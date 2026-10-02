// End-to-end: the whole exam flow through a real browser, app, worker and engine.
// Needs DATABASE_URL (to seed an admin, fast-forward one deadline and clean up)
// and E2E_BASE_URL pointing at the running app. Every name is unique per run.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { sql } from "../lib/db.ts";
import { hashPassword } from "../lib/password.ts";

const run = randomBytes(3).toString("hex");
const batch = `E2E-${run}`;
const adminName = `e2eadmin${run}`;
const adminPassword = `Pw-${randomBytes(6).toString("hex")}`;
const questionTitle = `E2E sum ${run}`;
const mcqTitle = `E2E mcq ${run}`;
const examTitle = `E2E exam ${run}`;
const students = [`e2e${run}a`, `e2e${run}b`];
const CORRECT = "n = int(input())\nprint(n * (n + 1) // 2)\n";
const WRONG = "n = int(input())\nprint(n * n)\n";

const localInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

async function signIn(browser: Browser, username: string, password: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByLabel("Username or roll number").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return page;
}

test.beforeAll(async () => {
  await sql`INSERT INTO users (username, name, role, password_hash) VALUES (${adminName}, 'E2E Admin', 'admin', ${await hashPassword(adminPassword)})`;
});

test.afterAll(async () => {
  await sql.begin(async (tx) => {
    const exams = (await tx<{ id: string }[]>`SELECT id FROM exams WHERE title = ${examTitle}`).map((row) => row.id);
    const attempts = (await tx<{ id: string }[]>`SELECT id FROM attempts WHERE exam_id = ANY(${exams})`).map((row) => row.id);
    await tx`DELETE FROM submissions WHERE attempt_id = ANY(${attempts})`;
    await tx`DELETE FROM attempts WHERE id = ANY(${attempts})`;
    await tx`DELETE FROM exams WHERE id = ANY(${exams})`;
    await tx`DELETE FROM questions WHERE title = ${questionTitle} OR title = ${mcqTitle}`;
    await tx`DELETE FROM users WHERE batch = ${batch} OR username = ${adminName} OR username = ${`e2efac${run}`}`;
  });
  await sql.end();
});

test("import → author → exam → run/submit → auto-submit → results", async ({ browser }) => {
  // Admin: import two students and create a faculty account.
  const admin = await signIn(browser, adminName, adminPassword);
  await admin.goto("/admin");
  const csv = `roll_no,name,batch\n${students[0]},E2E Student A,${batch}\n${students[1]},E2E Student B,${batch}\n`;
  await admin.locator('input[type=file][accept=".csv,text/csv"]').setInputFiles({ name: "students.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(admin.getByText("Created 2 accounts")).toBeVisible();
  const passwordOf = async (username: string) =>
    // The credentials table comes before the directory, which lists the same names.
    (await admin.locator("tr", { hasText: username }).first().locator("td").nth(3).innerText()).trim();
  const studentPasswords = [await passwordOf(students[0]), await passwordOf(students[1])];

  const facultyName = `e2efac${run}`;
  const staff = admin.locator("form", { hasText: "Create account" });
  await staff.getByLabel("Username").fill(facultyName);
  await staff.getByLabel("Full name").fill("E2E Faculty");
  await staff.getByRole("button", { name: "Create account" }).click();
  await expect(admin.locator("tr", { hasText: facultyName }).first()).toBeVisible();
  const facultyPassword = await passwordOf(facultyName);

  // Faculty: a question with one sample and one hidden test.
  const faculty = await signIn(browser, facultyName, facultyPassword);
  await faculty.goto("/faculty/questions/new");
  await faculty.getByPlaceholder("Sum of N numbers").fill(questionTitle);
  await faculty.getByPlaceholder("Input (stdin)").nth(0).fill("5\n");
  await faculty.getByPlaceholder("Expected output").nth(0).fill("15\n");
  await faculty.getByPlaceholder("Input (stdin)").nth(1).fill("1000000\n");
  await faculty.getByPlaceholder("Expected output").nth(1).fill("500000500000\n");
  await faculty.getByRole("button", { name: "Save question" }).click();
  await expect(faculty.getByText("Saved.")).toBeVisible();

  // Faculty: a multiple-choice question whose answer is "3".
  await faculty.goto("/faculty/questions/new");
  await faculty.getByRole("button", { name: "Multiple choice" }).click();
  await faculty.getByPlaceholder("Sum of N numbers").fill(mcqTitle);
  for (const [index, text] of ["2", "3", "4", "5"].entries()) await faculty.getByPlaceholder(`Option ${index + 1}`).fill(text);
  await faculty.getByLabel("Option 2 is correct").check();
  await faculty.getByRole("button", { name: "Save question" }).click();
  await expect(faculty.getByText("Saved.")).toBeVisible();

  // Faculty: an exam open now for the batch, without lockdown.
  await faculty.goto("/faculty/exams/new");
  await faculty.getByPlaceholder("CS201 Lab Test 1").fill(examTitle);
  const times = faculty.locator("input[type=datetime-local]");
  await times.nth(0).fill(localInput(new Date(Date.now() - 5 * 60_000)));
  await times.nth(1).fill(localInput(new Date(Date.now() + 2 * 3600_000)));
  const otherBatch = faculty.getByPlaceholder("Other batch + Enter");
  await otherBatch.fill(batch);
  await otherBatch.press("Enter");
  await faculty.getByLabel("Require fullscreen", { exact: false }).uncheck();
  await faculty.getByLabel("Block pasting", { exact: false }).uncheck();
  await faculty.locator("select", { hasText: "+ Add question" }).selectOption({ label: questionTitle });
  await faculty.locator("select", { hasText: "+ Add question" }).selectOption({ label: mcqTitle });
  await faculty.getByLabel("Published (visible to students)").check();
  await faculty.getByRole("button", { name: "Save exam" }).click();
  await expect(faculty.getByText("Saved.")).toBeVisible();
  const examId = faculty.url().split("/faculty/exams/")[1].split("?")[0];

  // Student A: wrong Run, then a correct Submit.
  const a = await signIn(browser, students[0], studentPasswords[0]);
  await expect(a.getByText(examTitle)).toBeVisible();
  await a.getByRole("button", { name: "Start exam →" }).click();
  await a.waitForURL(`**/exam/${examId}`);
  await a.getByLabel("Language").selectOption("python");
  await a.locator(".cm-content").fill(WRONG);
  await a.getByRole("button", { name: "Run code" }).click();
  await expect(a.getByText("0/1 test cases passed")).toBeVisible();
  await a.locator(".cm-content").fill(CORRECT);
  await a.getByRole("button", { name: "Submit" }).click();
  await expect(a.getByText("All test cases passed")).toBeVisible();
  await a.locator("nav").getByRole("button", { name: "2" }).click();
  await a.getByRole("radio", { name: /\b3$/ }).check();
  await expect(a.getByText("Saved", { exact: true })).toBeVisible();
  a.on("dialog", (dialog) => void dialog.accept());
  await a.locator("header").getByRole("button", { name: "End exam" }).click();
  await a.getByRole("dialog").getByRole("button", { name: "End exam" }).click();
  await expect(a.getByText("Exam submitted")).toBeVisible();

  // Student B: writes the answer but never submits; the clock runs out.
  const b = await signIn(browser, students[1], studentPasswords[1]);
  await b.getByRole("button", { name: "Start exam →" }).click();
  await b.waitForURL(`**/exam/${examId}`);
  await b.getByLabel("Language").selectOption("python");
  await b.locator(".cm-content").fill(CORRECT);
  await b.locator("nav").getByRole("button", { name: "2" }).click();
  await b.getByRole("radio", { name: /\b5$/ }).check();
  await expect
    .poll(async () => (await sql`
      SELECT 1 FROM mcq_answers m JOIN attempts at ON at.id = m.attempt_id JOIN users u ON u.id = at.user_id
      WHERE at.exam_id = ${examId} AND u.username = ${students[1]}`).length, { timeout: 30_000 })
    .toBe(1);
  await expect
    .poll(async () => (await sql`
      SELECT 1 FROM drafts d JOIN attempts at ON at.id = d.attempt_id JOIN users u ON u.id = at.user_id
      WHERE at.exam_id = ${examId} AND u.username = ${students[1]} AND d.source = ${CORRECT}`).length, { timeout: 30_000 })
    .toBe(1);
  await sql`
    UPDATE attempts SET deadline_at = now() - interval '25 seconds'
    WHERE exam_id = ${examId} AND user_id = (SELECT id FROM users WHERE username = ${students[1]})`;
  await expect
    .poll(
      async () =>
        (
          await sql<{ verdict: string | null }[]>`
            SELECT s.verdict FROM submissions s JOIN attempts at ON at.id = s.attempt_id JOIN users u ON u.id = at.user_id
            WHERE at.exam_id = ${examId} AND u.username = ${students[1]} AND s.kind = 'submit' AND s.status = 'done'`
        )[0]?.verdict ?? null,
      { timeout: 120_000, intervals: [2000] },
    )
    .toBe("accepted");

  // Faculty: both students score full marks; release and export.
  await faculty.goto(`/faculty/exams/${examId}/results`);
  // A: coding 100 + MCQ 100. B: coding 100 (auto-submitted) + wrong MCQ 0.
  await expect(faculty.locator("tr", { hasText: students[0] }).locator("td").nth(6)).toHaveText("200");
  await expect(faculty.locator("tr", { hasText: students[1] }).locator("td").nth(6)).toHaveText("100");
  await faculty.getByRole("button", { name: "Release results" }).click();
  await expect(faculty.getByRole("button", { name: "Hide results" })).toBeVisible();
  const exported = await (await faculty.request.get(`/faculty/exams/${examId}/results.csv`)).text();
  expect(exported).toContain(`${students[0]},E2E Student A,${batch},finished`);
  expect(exported).toContain(`${students[1]},E2E Student B,${batch},finished`);
  expect(exported.split("\r\n").filter((line) => line.startsWith(`e2e${run}`))).toHaveLength(2);

  // Student A sees the released score.
  await a.goto("/student");
  await expect(a.locator("div", { hasText: examTitle }).getByText("/ 200")).toBeVisible();
  await a.getByRole("link", { name: "View results" }).click();
  await expect(a.getByText("Best submission: 2/2 test cases")).toBeVisible();
  await expect(a.getByText("correct", { exact: true })).toBeVisible();
});
