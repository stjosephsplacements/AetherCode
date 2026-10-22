// End to end through a real browser, the platform and the engine, as v1's
// e2e/exam-flow.spec.ts (M8). The college data is set up through the gateway
// like smoke.py (E2E_ADMIN_FILE holds "<email> <password>"); the browser then
// does what a student and a teacher do: forced password change, open and start
// the exam, a failing Run, a passing Submit, End test, release, and the score.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const GATEWAY = `${process.env.E2E_GATEWAY_URL ?? "http://127.0.0.1:8380"}/api`;
const [adminEmail, adminPassword] = readFileSync(process.env.E2E_ADMIN_FILE ?? `${homedir()}/aethercode-admin.txt`, "utf8").trim().split(/\s+/);
const run = randomBytes(3).toString("hex").toUpperCase();
const CORRECT = "n = int(input())\nprint(n * (n + 1) // 2)\n";
const WRONG = "n = int(input())\nprint(n * n)\n";

async function call<T>(method: string, path: string, body?: unknown, token?: string, expectStatus = 200): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(GATEWAY + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(method === "GET" ? {} : { "Idempotency-Key": crypto.randomUUID() }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 503 && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }
    const payload = await response.json().catch(() => null);
    if (response.status !== expectStatus) throw new Error(`${method} ${path}: HTTP ${response.status} ${JSON.stringify(payload)}`);
    return payload as T;
  }
}

type Setup = { examId: string; roll: string; password: string; title: string };

/** A batch with one student and a published one-question exam open in 20 s. */
async function setUp(): Promise<Setup> {
  const admin = (await call<{ access_token: string }>("POST", "/identity/v1/auth/login", { identifier: adminEmail, password: adminPassword })).access_token;
  const tenant = (await call<{ items: { id: string }[] }>("GET", "/tenant/v1/tenants", undefined, admin)).items[0]!.id;
  const department = (await call<{ items: { id: string }[] }>("GET", `/tenant/v1/tenants/${tenant}/departments`, undefined, admin)).items[0]!.id;
  const organization = await call<{ id: string }>("POST", "/tenant/v1/placement-organizations", { code: `E2E${run}`, legal_name: `E2E ${run}` }, admin, 201);
  const placement = await call<{ id: string }>("POST", `/tenant/v1/placement-organizations/${organization.id}/departments`, { code: "E2E", name: "E2E placement" }, admin, 201);
  const batch = await call<{ id: string }>("POST", `/tenant/v1/tenants/${tenant}/batches`, { department_id: department, code: `E2E${run}`, name: `E2E-${run}`, academic_year: "2026-2027" }, admin, 201);
  await new Promise((resolve) => setTimeout(resolve, 5000)); // the batch reaches the user service
  const imported = await call<{ imported: { roll_number: string; password: string }[] }>("POST", `/user/v1/tenants/${tenant}/students/import`, {
    batch_id: batch.id, college_department_id: department, placement_department_id: placement.id,
    students: [{ roll_number: `E2E${run}A`, name: "E2E Student" }],
  }, admin, 201);

  const question = await call<{ question_version: { id: string; version: number } }>("POST", "/question-bank/v1/questions", {
    slug: `e2e-${run.toLowerCase()}`, title: `E2E sum ${run}`, prompt_markdown: "Print n(n+1)/2.", difficulty: "easy",
    supported_languages: ["python3"], time_limit_ms: 2000, memory_limit_kib: 262144, tags: [],
  }, admin, 201);
  const version = await call<{ id: string; version: number }>("PUT", `/question-bank/v1/question-versions/${question.question_version.id}/tests`, {
    expected_question_version: question.question_version.version,
    tests: [
      { input: "5\n", expected_output: "15\n", sample: true },
      { input: "10\n", expected_output: "55\n", sample: true },
      { input: "1000000\n", expected_output: "500000500000\n", sample: false },
      { input: "1\n", expected_output: "1\n", sample: false },
    ],
  }, admin);
  // Publishing needs a model solution that passes every test (ADR-0047).
  const checks = `/question-bank/v1/question-versions/${version.id}/model-checks`;
  await call("POST", checks, { language: "python3", source: "n = int(input())\nprint(n * (n + 1) // 2)\n" }, admin, 202);
  for (let tries = 0; ; tries++) {
    const done = await call<{ lifecycle_state: string; verdict: string | null }[]>("GET", checks, undefined, admin);
    if (done[0] && done[0].lifecycle_state !== "queued") {
      if (done[0].verdict !== "accepted") throw new Error(`the model solution failed: ${JSON.stringify(done[0])}`);
      break;
    }
    if (tries > 60) throw new Error("the model-solution check never finished");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await call("POST", `/question-bank/v1/question-versions/${version.id}/publish`, { expected_question_version: version.version }, admin);

  const policy = await call<{ id: string; version: number }>("POST", `/assessment/v1/tenants/${tenant}/proctor-policies`, { name: `E2E ${run}` }, admin, 201);
  const policyVersion = await call<{ id: string }>("POST", `/assessment/v1/tenants/${tenant}/proctor-policies/${policy.id}/versions`, { expected_policy_version: policy.version, policy: { seb_required: false } }, admin, 201);
  await call("POST", `/assessment/v1/tenants/${tenant}/proctor-policy-versions/${policyVersion.id}/publish`, {}, admin);
  const exam = await call<{ id: string; version: number }>("POST", `/assessment/v1/tenants/${tenant}/exams`, { external_reference: `E2E-${run}` }, admin, 201);
  const opens = new Date(Date.now() + 20_000);
  const title = `E2E exam ${run}`;
  const examVersion = await call<{ id: string; opens_at: string; closes_at: string }>("POST", `/assessment/v1/tenants/${tenant}/exams/${exam.id}/versions`, {
    expected_exam_version: exam.version, title, instructions_markdown: "End to end.", opens_at: opens.toISOString().replace(/\.\d+Z$/, "Z"),
    closes_at: new Date(opens.getTime() + 2 * 3600_000).toISOString().replace(/\.\d+Z$/, "Z"), duration_seconds: 3600, proctor_policy_version_id: policyVersion.id,
  }, admin, 201);
  const path = `/assessment/v1/tenants/${tenant}/exam-versions/${examVersion.id}`;
  const content = async () => (await call<{ content_version: number }>("GET", path, undefined, admin)).content_version;
  const section = await call<{ id: string }>("POST", `${path}/sections`, { expected_content_version: await content(), position: 1, title: "Coding", instructions_markdown: "", time_limit_seconds: null }, admin, 201);
  await call("POST", `${path}/sections/${section.id}/items`, { expected_content_version: await content(), position: 1, question_version_id: version.id, maximum_score: "10" }, admin, 201);
  await call("POST", `${path}/publish`, { expected_content_version: await content() }, admin);
  await call("POST", `${path}/assignment-rules`, { target_type: "batch", target_id: batch.id, available_from: examVersion.opens_at, available_until: examVersion.closes_at, accommodations: {} }, admin, 201);
  return { examId: exam.id, roll: imported.imported[0]!.roll_number, password: imported.imported[0]!.password, title };
}

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

async function signIn(browser: Browser, identifier: string, password: string): Promise<Page> {
  const page = await newPage(browser);
  await page.goto("/login");
  await page.getByLabel("Roll number or username").fill(identifier);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
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
  const setup = await setUp();

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
  await expect(student.getByText(setup.title)).toBeVisible();
  // Listed under Upcoming until it opens; its link leads to the same exam page.
  await student.getByRole("link", { name: new RegExp(setup.title) }).first().click();
  const start = student.getByRole("button", { name: /Start exam/ });
  await expect(start).toBeEnabled({ timeout: 60_000 });
  await start.click();
  await student.waitForURL("**/student/attempts/**");

  // A wrong Run fails both samples; a correct Submit passes every test.
  await student.getByLabel("Language").selectOption("python3");
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

  // Teacher: release the results from the live monitor.
  const teacher = await signIn(browser, adminEmail!, adminPassword!);
  teacher.on("dialog", (dialog) => void dialog.accept());
  await teacher.goto(`/staff/exams/${setup.examId}/monitor`);
  await teacher.getByRole("button", { name: "Release results" }).click();
  await expect(teacher.getByRole("button", { name: "Hide results" })).toBeVisible();

  // Student: the released score is full marks.
  await expect
    .poll(async () => {
      await student.goto(resultURL);
      return student.getByText("Your score").isVisible();
    }, { timeout: 120_000, intervals: [3000] })
    .toBe(true);
  await expect(student.getByText(/\b10\s*\/\s*10\b/).first()).toBeVisible();
});
