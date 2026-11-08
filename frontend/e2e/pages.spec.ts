// Opens every page of the web UI as each kind of user and fails on a server error, an error page,
// a 404 on a route that must exist, or an uncaught script error. Run after seeding one exam.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { setUp, type Setup } from "./seed";
import { adminEmail, adminPassword, adminSession, adminTotpSecret, call, dismissOnboarding, freshTotp } from "./support";

const run = randomBytes(3).toString("hex").toUpperCase();
let seed: Setup;
let staffLogin: { username: string; password: string };
let studentPassword = "";

test.beforeAll(async () => {
  test.setTimeout(240_000);
  seed = await setUp(run, 10_000);
  const admin = await adminSession();
  // A department user and the seeded student sign in with passwords they chose, as in real use.
  const username = `pages.${run.toLowerCase()}`;
  const staff = await call<{ password: string }>("POST", `/user/v1/tenants/${seed.tenant}/staff`, {
    username, display_name: "Pages Staff", role: "department_user", department_id: seed.departmentId,
  }, admin, 201);
  const chosen = `Pg-${run}-Changed1x`;
  const staffPair = await call<{ access_token: string }>("POST", "/identity/v1/auth/login", { identifier: username, password: staff.password });
  await call("POST", "/identity/v1/auth/password", { current_password: staff.password, new_password: chosen }, staffPair.access_token, 204);
  staffLogin = { username, password: chosen };
  const studentPair = await call<{ access_token: string }>("POST", "/identity/v1/auth/login", { identifier: seed.roll, password: seed.password });
  studentPassword = `Pg-${run}-Student1x`;
  await call("POST", "/identity/v1/auth/password", { current_password: seed.password, new_password: studentPassword }, studentPair.access_token, 204);
});

async function signIn(context: BrowserContext, identifier: string, password: string, totp?: string): Promise<void> {
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Roll number or username").fill(identifier);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  if (totp) {
    await page.locator("#code").fill(await freshTotp(totp));
    await page.getByRole("button", { name: /verify and sign in/i }).click();
  }
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await page.close();
}

type Problems = string[];

async function visit(context: BrowserContext, path: string, options: { allowRedirect?: boolean } = {}): Promise<Problems> {
  const page: Page = await context.newPage();
  const problems: Problems = [];
  page.on("pageerror", (error) => problems.push(`script error: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 500) problems.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
  });
  try {
    const response = await page.goto(path, { waitUntil: "load", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    if (response && response.status() >= 400) problems.push(`HTTP ${response.status()} for the page itself`);
    if (!options.allowRedirect && new URL(page.url()).pathname !== path.split("?")[0]) problems.push(`redirected to ${new URL(page.url()).pathname}`);
    if (await page.getByText("Something broke on our side").isVisible().catch(() => false)) problems.push("error page shown");
    if (await page.getByText("This page doesn't exist").isVisible().catch(() => false)) problems.push("404 page shown");
  } finally {
    await page.close();
  }
  return problems;
}

async function sweep(context: BrowserContext, paths: string[], options?: { allowRedirect?: boolean }) {
  const failures: string[] = [];
  for (const path of paths) {
    const problems = await visit(context, path, options);
    if (problems.length) failures.push(`${path}: ${problems.join("; ")}`);
  }
  expect(failures, failures.join("\n")).toEqual([]);
}

const PUBLIC = ["/login", "/about", "/architecture", "/changelog", "/help", "/privacy", "/security", "/status", "/system-check", "/terms"];

test("public pages open without signing in", async ({ browser }) => {
  await sweep(await browser.newContext(), PUBLIC);
});

test("platform administrator: console and college workspace", async ({ browser }) => {
  test.setTimeout(420_000);
  const context = await browser.newContext();
  await signIn(context, adminEmail, adminPassword, adminTotpSecret);
  await sweep(context, ["/admin", "/admin/admins", "/admin/analytics", "/admin/audit", "/admin/colleges", "/admin/incidents", "/admin/status", "/placement", "/placement/departments", "/placement/staff", "/placement/questions", "/placement/exams", "/account/password", "/account/security"]);

  const open = await context.newPage();
  await open.goto(`/admin/open?college=${seed.tenant}&next=${encodeURIComponent("/staff")}`);
  await dismissOnboarding(open);
  await open.close();
  await sweep(context, [
    "/staff", "/staff/accounts", "/staff/analytics", "/staff/audit", "/staff/calendar", "/staff/community", "/staff/departments",
    "/staff/exams", "/staff/exams/new", "/staff/get-started", "/staff/help", "/staff/permissions",
    "/staff/questions", "/staff/questions/new", "/staff/status", "/staff/students",
    `/staff/exams/${seed.examId}`, `/staff/exams/${seed.examId}/monitor`, `/staff/exams/${seed.examId}/preview`,
    `/staff/exams/${seed.examId}/results`, `/staff/exams/${seed.examId}/similarity`,
    `/staff/questions/${seed.questionVersionId}`,
  ]);
  // These routes only forward to the page that now holds their content.
  await sweep(context, ["/staff/organisation", "/staff/roles"], { allowRedirect: true });
});

test("department user: staff workspace", async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext();
  await signIn(context, staffLogin.username, staffLogin.password);
  // A department user sees their own subset; pages they may not open must refuse, never crash.
  const failures: string[] = [];
  for (const path of ["/staff", "/staff/exams", "/staff/students", "/staff/questions", "/staff/departments", "/staff/help", "/staff/calendar", "/staff/community", "/staff/analytics", "/staff/accounts", "/staff/roles", "/staff/permissions", "/staff/audit"]) {
    const problems = await visit(context, path, { allowRedirect: true });
    if (problems.length) failures.push(`${path}: ${problems.join("; ")}`);
  }
  expect(failures, failures.join("\n")).toEqual([]);
});

test("student: dashboard, exams, practice, results and profile", async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext();
  await signIn(context, seed.roll, studentPassword);
  await sweep(context, [
    "/student", "/student/blogs", "/student/completed", "/student/contests", "/student/exams", "/student/hackathons", "/student/help",
    "/student/interviews", "/student/open-source", "/student/performance", "/student/practice", "/student/profile",
    "/student/resume", "/student/scheduled", "/student/tasks", "/account/password", "/account/security",
  ]);
  await sweep(context, ["/student/my-results", "/student/progress"], { allowRedirect: true });
});

test("a student cannot open staff or admin pages", async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context, seed.roll, studentPassword);
  for (const path of ["/admin", "/admin/colleges", "/staff", "/staff/students", "/placement"]) {
    const page = await context.newPage();
    const response = await page.goto(path);
    // A refusal can stream in after the first byte (a client-side redirect), so give it a moment.
    await page.waitForURL((url) => !/^\/(admin|staff|placement)/.test(url.pathname), { timeout: 6_000 }).catch(() => {});
    const landed = new URL(page.url()).pathname;
    // Either sent away, or refused outright (401/403/404) without rendering any console content.
    const refused = [401, 403, 404].includes(response?.status() ?? 0);
    const sentAway = !/^\/(admin|staff|placement)/.test(landed);
    expect(refused || sentAway, `${path} must not open for a student (status ${response?.status()}, landed on ${landed})`).toBe(true);
    await expect(page.getByRole("link", { name: /Open workspace|Colleges|Students/ })).toHaveCount(0);
    await page.close();
  }
});
