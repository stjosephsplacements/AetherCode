# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pages.spec.ts >> student: dashboard, exams, practice, results and profile
- Location: e2e/pages.spec.ts:115:1

# Error details

```
Error: /student/blogs: error page shown
/student/contests: error page shown
/student/hackathons: error page shown
/student/interviews: error page shown
/student/my-results: redirected to /student/completed
/student/open-source: error page shown
/student/profile: error page shown
/student/progress: redirected to /student/performance
/student/tasks: error page shown

expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 11

- Array []
+ Array [
+   "/student/blogs: error page shown",
+   "/student/contests: error page shown",
+   "/student/hackathons: error page shown",
+   "/student/interviews: error page shown",
+   "/student/my-results: redirected to /student/completed",
+   "/student/open-source: error page shown",
+   "/student/profile: error page shown",
+   "/student/progress: redirected to /student/performance",
+   "/student/tasks: error page shown",
+ ]
```

# Test source

```ts
  1   | // Opens every page of the web UI as each kind of user and fails on a server error, an error page,
  2   | // a 404 on a route that must exist, or an uncaught script error. Run after seeding one exam.
  3   | import { expect, test, type BrowserContext, type Page } from "@playwright/test";
  4   | import { randomBytes } from "node:crypto";
  5   | import { setUp, type Setup } from "./seed";
  6   | import { adminEmail, adminPassword, adminSession, adminTotpSecret, call, dismissOnboarding, freshTotp } from "./support";
  7   | 
  8   | const run = randomBytes(3).toString("hex").toUpperCase();
  9   | let seed: Setup;
  10  | let staffLogin: { username: string; password: string };
  11  | let studentPassword = "";
  12  | 
  13  | test.beforeAll(async () => {
  14  |   test.setTimeout(240_000);
  15  |   seed = await setUp(run, 10_000);
  16  |   const admin = await adminSession();
  17  |   // A department user and the seeded student sign in with passwords they chose, as in real use.
  18  |   const username = `pages.${run.toLowerCase()}`;
  19  |   const staff = await call<{ password: string }>("POST", `/user/v1/tenants/${seed.tenant}/staff`, {
  20  |     username, display_name: "Pages Staff", role: "department_user", department_id: seed.departmentId,
  21  |   }, admin, 201);
  22  |   const chosen = `Pg-${run}-Changed1x`;
  23  |   const staffPair = await call<{ access_token: string }>("POST", "/identity/v1/auth/login", { identifier: username, password: staff.password });
  24  |   await call("POST", "/identity/v1/auth/password", { current_password: staff.password, new_password: chosen }, staffPair.access_token, 204);
  25  |   staffLogin = { username, password: chosen };
  26  |   const studentPair = await call<{ access_token: string }>("POST", "/identity/v1/auth/login", { identifier: seed.roll, password: seed.password });
  27  |   studentPassword = `Pg-${run}-Student1x`;
  28  |   await call("POST", "/identity/v1/auth/password", { current_password: seed.password, new_password: studentPassword }, studentPair.access_token, 204);
  29  | });
  30  | 
  31  | async function signIn(context: BrowserContext, identifier: string, password: string, totp?: string): Promise<void> {
  32  |   const page = await context.newPage();
  33  |   await page.goto("/login");
  34  |   await page.getByLabel("Roll number or username").fill(identifier);
  35  |   await page.locator("#password").fill(password);
  36  |   await page.getByRole("button", { name: /sign in/i }).click();
  37  |   if (totp) {
  38  |     await page.locator("#code").fill(await freshTotp(totp));
  39  |     await page.getByRole("button", { name: /verify and sign in/i }).click();
  40  |   }
  41  |   await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  42  |   await page.close();
  43  | }
  44  | 
  45  | type Problems = string[];
  46  | 
  47  | async function visit(context: BrowserContext, path: string, options: { allowRedirect?: boolean } = {}): Promise<Problems> {
  48  |   const page: Page = await context.newPage();
  49  |   const problems: Problems = [];
  50  |   page.on("pageerror", (error) => problems.push(`script error: ${error.message}`));
  51  |   page.on("response", (response) => {
  52  |     if (response.status() >= 500) problems.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
  53  |   });
  54  |   try {
  55  |     const response = await page.goto(path, { waitUntil: "load", timeout: 60_000 });
  56  |     await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  57  |     if (response && response.status() >= 400) problems.push(`HTTP ${response.status()} for the page itself`);
  58  |     if (!options.allowRedirect && new URL(page.url()).pathname !== path.split("?")[0]) problems.push(`redirected to ${new URL(page.url()).pathname}`);
  59  |     if (await page.getByText("Something broke on our side").isVisible().catch(() => false)) problems.push("error page shown");
  60  |     if (await page.getByText("This page doesn't exist").isVisible().catch(() => false)) problems.push("404 page shown");
  61  |   } finally {
  62  |     await page.close();
  63  |   }
  64  |   return problems;
  65  | }
  66  | 
  67  | async function sweep(context: BrowserContext, paths: string[], options?: { allowRedirect?: boolean }) {
  68  |   const failures: string[] = [];
  69  |   for (const path of paths) {
  70  |     const problems = await visit(context, path, options);
  71  |     if (problems.length) failures.push(`${path}: ${problems.join("; ")}`);
  72  |   }
> 73  |   expect(failures, failures.join("\n")).toEqual([]);
      |                                         ^ Error: /student/blogs: error page shown
  74  | }
  75  | 
  76  | const PUBLIC = ["/login", "/about", "/architecture", "/changelog", "/help", "/privacy", "/security", "/status", "/system-check", "/terms"];
  77  | 
  78  | test("public pages open without signing in", async ({ browser }) => {
  79  |   await sweep(await browser.newContext(), PUBLIC);
  80  | });
  81  | 
  82  | test("platform administrator: console and college workspace", async ({ browser }) => {
  83  |   test.setTimeout(420_000);
  84  |   const context = await browser.newContext();
  85  |   await signIn(context, adminEmail, adminPassword, adminTotpSecret);
  86  |   await sweep(context, ["/admin", "/admin/admins", "/admin/analytics", "/admin/audit", "/admin/colleges", "/admin/incidents", "/admin/status", "/placement", "/account/password", "/account/security"]);
  87  | 
  88  |   const open = await context.newPage();
  89  |   await open.goto(`/admin/open?college=${seed.tenant}&next=${encodeURIComponent("/staff")}`);
  90  |   await dismissOnboarding(open);
  91  |   await open.close();
  92  |   await sweep(context, [
  93  |     "/staff", "/staff/accounts", "/staff/analytics", "/staff/audit", "/staff/calendar", "/staff/community", "/staff/departments",
  94  |     "/staff/exams", "/staff/exams/new", "/staff/get-started", "/staff/help", "/staff/organisation", "/staff/permissions",
  95  |     "/staff/questions", "/staff/questions/new", "/staff/roles", "/staff/status", "/staff/students",
  96  |     `/staff/exams/${seed.examId}`, `/staff/exams/${seed.examId}/monitor`, `/staff/exams/${seed.examId}/preview`,
  97  |     `/staff/exams/${seed.examId}/results`, `/staff/exams/${seed.examId}/similarity`,
  98  |     `/staff/questions/${seed.questionVersionId}`,
  99  |   ]);
  100 | });
  101 | 
  102 | test("department user: staff workspace", async ({ browser }) => {
  103 |   test.setTimeout(300_000);
  104 |   const context = await browser.newContext();
  105 |   await signIn(context, staffLogin.username, staffLogin.password);
  106 |   // A department user sees their own subset; pages they may not open must refuse, never crash.
  107 |   const failures: string[] = [];
  108 |   for (const path of ["/staff", "/staff/exams", "/staff/students", "/staff/questions", "/staff/departments", "/staff/help", "/staff/calendar", "/staff/community", "/staff/analytics", "/staff/accounts", "/staff/roles", "/staff/permissions", "/staff/audit"]) {
  109 |     const problems = await visit(context, path, { allowRedirect: true });
  110 |     if (problems.length) failures.push(`${path}: ${problems.join("; ")}`);
  111 |   }
  112 |   expect(failures, failures.join("\n")).toEqual([]);
  113 | });
  114 | 
  115 | test("student: dashboard, exams, practice, results and profile", async ({ browser }) => {
  116 |   test.setTimeout(300_000);
  117 |   const context = await browser.newContext();
  118 |   await signIn(context, seed.roll, studentPassword);
  119 |   await sweep(context, [
  120 |     "/student", "/student/blogs", "/student/completed", "/student/contests", "/student/exams", "/student/hackathons", "/student/help",
  121 |     "/student/interviews", "/student/my-results", "/student/open-source", "/student/performance", "/student/practice", "/student/profile",
  122 |     "/student/progress", "/student/resume", "/student/scheduled", "/student/tasks", "/account/password", "/account/security",
  123 |   ]);
  124 | });
  125 | 
  126 | test("a student cannot open staff or admin pages", async ({ browser }) => {
  127 |   const context = await browser.newContext();
  128 |   await signIn(context, seed.roll, studentPassword);
  129 |   for (const path of ["/admin", "/staff", "/staff/students", "/placement"]) {
  130 |     const page = await context.newPage();
  131 |     await page.goto(path);
  132 |     expect(new URL(page.url()).pathname, `${path} must not open for a student`).not.toMatch(/^\/(admin|staff|placement)/);
  133 |     await page.close();
  134 |   }
  135 | });
  136 | 
```