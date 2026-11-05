# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pages.spec.ts >> a student cannot open staff or admin pages
- Location: e2e/pages.spec.ts:126:1

# Error details

```
Error: /admin must not open for a student

expect(received).not.toMatch(expected)

Expected pattern: not /^\/(admin|staff|placement)/
Received string:      "/admin"
```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - generic [ref=f1e2]:
    - banner [ref=f1e3]:
      - generic [ref=f1e4]:
        - link "AetherCode" [ref=f1e5] [cursor=pointer]:
          - /url: /student
        - navigation "Main" [ref=f1e8]:
          - link "Dashboard" [ref=f1e9] [cursor=pointer]:
            - /url: /student
          - button "Exams" [ref=f1e12]
          - link "Practice" [ref=f1e17] [cursor=pointer]:
            - /url: /student/practice
          - link "Performance" [ref=f1e20] [cursor=pointer]:
            - /url: /student/performance
          - button "Career" [ref=f1e23]
          - button "Me" [ref=f1e28]
        - generic [ref=f1e33]:
          - button "Switch to dark theme" [ref=f1e34]
          - button "Account" [ref=f1e37]:
            - generic [ref=f1e38]: E
    - main [ref=f1e39]:
      - generic [ref=f1e40]:
        - generic [ref=f1e42]:
          - generic [ref=f1e43]:
            - generic [ref=f1e44]: Friday, 6 November
            - heading "Good morning, E2E" [level=1] [ref=f1e45]
            - paragraph [ref=f1e46]: You have an exam open right now. Good luck.
            - generic [ref=f1e47]:
              - link "Start exam" [ref=f1e48] [cursor=pointer]:
                - /url: /student/exams/01a1ad58-f40a-7774-ac7e-e574754e7f7e
              - link "All my exams" [ref=f1e51] [cursor=pointer]:
                - /url: /student/exams
          - generic [ref=f1e52]:
            - generic [ref=f1e53]:
              - generic [ref=f1e54]: Open now
              - generic [ref=f1e55]: 1 h limit
            - heading "E2E exam 8F9BA2" [level=2] [ref=f1e56]
            - paragraph [ref=f1e57]: Fri, 6 Nov, 1:44 am to 3:44 am
            - generic [ref=f1e58]:
              - generic [ref=f1e59]: Closes in
              - time [ref=f1e60]: 1h 59m
        - generic [ref=f1e61]:
          - generic [ref=f1e62]:
            - paragraph [ref=f1e66]: Exams ahead
            - paragraph [ref=f1e67]: "1"
            - paragraph [ref=f1e68]: 1 open now
          - generic [ref=f1e69]:
            - paragraph [ref=f1e73]: Completed
            - paragraph [ref=f1e74]: "0"
            - paragraph [ref=f1e75]: exams taken
          - generic [ref=f1e76]:
            - generic [ref=f1e77]:
              - paragraph [ref=f1e81]: Practice solved
              - paragraph [ref=f1e82]: "0"
              - paragraph [ref=f1e83]: of 0
            - generic [ref=f1e84]: 0%
          - generic [ref=f1e90]:
            - generic "This week" [ref=f1e95]:
              - generic "2026-11-02" [ref=f1e96]: M
              - generic "2026-11-03" [ref=f1e99]: T
              - generic "2026-11-04" [ref=f1e102]: W
              - generic "2026-11-05" [ref=f1e105]: T
              - generic "2026-11-06" [ref=f1e108]: F
              - generic "2026-11-07" [ref=f1e111]: S
              - generic "2026-11-08" [ref=f1e114]: S
            - paragraph [ref=f1e117]: Day streak
            - paragraph [ref=f1e118]: "0"
            - paragraph [ref=f1e119]: practice today to start
        - generic [ref=f1e120]:
          - generic [ref=f1e121]:
            - region "This week" [ref=f1e122]:
              - generic [ref=f1e123]:
                - heading "This week" [level=2] [ref=f1e124]
                - link "Full schedule" [ref=f1e125] [cursor=pointer]:
                  - /url: /student/scheduled
              - generic [ref=f1e126]:
                - generic [ref=f1e127]:
                  - generic [ref=f1e128]: M
                  - generic [ref=f1e129]: "2"
                - generic [ref=f1e130]:
                  - generic [ref=f1e131]: T
                  - generic [ref=f1e132]: "3"
                - generic [ref=f1e133]:
                  - generic [ref=f1e134]: W
                  - generic [ref=f1e135]: "4"
                - generic [ref=f1e136]:
                  - generic [ref=f1e137]: T
                  - generic [ref=f1e138]: "5"
                - generic [ref=f1e139]:
                  - generic [ref=f1e140]: F
                  - generic [ref=f1e141]: "6"
                - generic [ref=f1e144]:
                  - generic [ref=f1e145]: S
                  - generic [ref=f1e146]: "7"
                - generic [ref=f1e147]:
                  - generic [ref=f1e148]: S
                  - generic [ref=f1e149]: "8"
              - paragraph [ref=f1e150]:
                - generic [ref=f1e151]: exam
                - generic [ref=f1e153]: practised
            - region "Coming up" [ref=f1e155]:
              - generic [ref=f1e156]:
                - heading "Coming up" [level=2] [ref=f1e157]
                - link "All exams" [ref=f1e158] [cursor=pointer]:
                  - /url: /student/exams
              - list [ref=f1e159]:
                - listitem [ref=f1e160]:
                  - generic [ref=f1e161]:
                    - generic [ref=f1e163]:
                      - generic [ref=f1e164]: "6"
                      - generic [ref=f1e165]: Nov
                    - generic [ref=f1e166]:
                      - paragraph [ref=f1e167]: E2E exam 8F9BA2
                      - paragraph [ref=f1e168]: Fri, 6 Nov, 1:44 am to 3:44 am
                  - generic [ref=f1e169]:
                    - generic [ref=f1e170]:
                      - paragraph [ref=f1e171]: Closes in
                      - time [ref=f1e172]: 1h 59m
                    - link "Start" [ref=f1e173] [cursor=pointer]:
                      - /url: /student/exams/01a1ad58-f40a-7774-ac7e-e574754e7f7e
            - region "Recent exams" [ref=f1e174]:
              - generic [ref=f1e175]:
                - heading "Recent exams" [level=2] [ref=f1e176]
                - link "All completed" [ref=f1e177] [cursor=pointer]:
                  - /url: /student/completed
              - generic [ref=f1e178]: Finished exams appear here with their results.
          - complementary [ref=f1e179]:
            - region "Practice" [ref=f1e180]:
              - generic [ref=f1e181]:
                - heading "Practice" [level=2] [ref=f1e182]
                - link "Open" [ref=f1e183] [cursor=pointer]:
                  - /url: /student/practice
              - generic [ref=f1e184]:
                - generic [ref=f1e185]:
                  - generic [ref=f1e186]: "0"
                  - generic [ref=f1e192]: Easy
                  - generic [ref=f1e193]: of 0
                - generic [ref=f1e194]:
                  - generic [ref=f1e195]: "0"
                  - generic [ref=f1e201]: Medium
                  - generic [ref=f1e202]: of 0
                - generic [ref=f1e203]:
                  - generic [ref=f1e204]: "0"
                  - generic [ref=f1e210]: Hard
                  - generic [ref=f1e211]: of 0
              - paragraph [ref=f1e212]: Activity, last 14 weeks
              - img "0 active days in the last year" [ref=f1e213]:
                - generic [ref=f1e214]:
                  - generic "2026-08-03" [ref=f1e215]
                  - generic "2026-08-04" [ref=f1e216]
                  - generic "2026-08-05" [ref=f1e217]
                  - generic "2026-08-06" [ref=f1e218]
                  - generic "2026-08-07" [ref=f1e219]
                  - generic "2026-08-08" [ref=f1e220]
                  - generic "2026-08-09" [ref=f1e221]
                - generic [ref=f1e222]:
                  - generic "2026-08-10" [ref=f1e223]
                  - generic "2026-08-11" [ref=f1e224]
                  - generic "2026-08-12" [ref=f1e225]
                  - generic "2026-08-13" [ref=f1e226]
                  - generic "2026-08-14" [ref=f1e227]
                  - generic "2026-08-15" [ref=f1e228]
                  - generic "2026-08-16" [ref=f1e229]
                - generic [ref=f1e230]:
                  - generic "2026-08-17" [ref=f1e231]
                  - generic "2026-08-18" [ref=f1e232]
                  - generic "2026-08-19" [ref=f1e233]
                  - generic "2026-08-20" [ref=f1e234]
                  - generic "2026-08-21" [ref=f1e235]
                  - generic "2026-08-22" [ref=f1e236]
                  - generic "2026-08-23" [ref=f1e237]
                - generic [ref=f1e238]:
                  - generic "2026-08-24" [ref=f1e239]
                  - generic "2026-08-25" [ref=f1e240]
                  - generic "2026-08-26" [ref=f1e241]
                  - generic "2026-08-27" [ref=f1e242]
                  - generic "2026-08-28" [ref=f1e243]
                  - generic "2026-08-29" [ref=f1e244]
                  - generic "2026-08-30" [ref=f1e245]
                - generic [ref=f1e246]:
                  - generic "2026-08-31" [ref=f1e247]
                  - generic "2026-09-01" [ref=f1e248]
                  - generic "2026-09-02" [ref=f1e249]
                  - generic "2026-09-03" [ref=f1e250]
                  - generic "2026-09-04" [ref=f1e251]
                  - generic "2026-09-05" [ref=f1e252]
                  - generic "2026-09-06" [ref=f1e253]
                - generic [ref=f1e254]:
                  - generic "2026-09-07" [ref=f1e255]
                  - generic "2026-09-08" [ref=f1e256]
                  - generic "2026-09-09" [ref=f1e257]
                  - generic "2026-09-10" [ref=f1e258]
                  - generic "2026-09-11" [ref=f1e259]
                  - generic "2026-09-12" [ref=f1e260]
                  - generic "2026-09-13" [ref=f1e261]
                - generic [ref=f1e262]:
                  - generic "2026-09-14" [ref=f1e263]
                  - generic "2026-09-15" [ref=f1e264]
                  - generic "2026-09-16" [ref=f1e265]
                  - generic "2026-09-17" [ref=f1e266]
                  - generic "2026-09-18" [ref=f1e267]
                  - generic "2026-09-19" [ref=f1e268]
                  - generic "2026-09-20" [ref=f1e269]
                - generic [ref=f1e270]:
                  - generic "2026-09-21" [ref=f1e271]
                  - generic "2026-09-22" [ref=f1e272]
                  - generic "2026-09-23" [ref=f1e273]
                  - generic "2026-09-24" [ref=f1e274]
                  - generic "2026-09-25" [ref=f1e275]
                  - generic "2026-09-26" [ref=f1e276]
                  - generic "2026-09-27" [ref=f1e277]
                - generic [ref=f1e278]:
                  - generic "2026-09-28" [ref=f1e279]
                  - generic "2026-09-29" [ref=f1e280]
                  - generic "2026-09-30" [ref=f1e281]
                  - generic "2026-10-01" [ref=f1e282]
                  - generic "2026-10-02" [ref=f1e283]
                  - generic "2026-10-03" [ref=f1e284]
                  - generic "2026-10-04" [ref=f1e285]
                - generic [ref=f1e286]:
                  - generic "2026-10-05" [ref=f1e287]
                  - generic "2026-10-06" [ref=f1e288]
                  - generic "2026-10-07" [ref=f1e289]
                  - generic "2026-10-08" [ref=f1e290]
                  - generic "2026-10-09" [ref=f1e291]
                  - generic "2026-10-10" [ref=f1e292]
                  - generic "2026-10-11" [ref=f1e293]
                - generic [ref=f1e294]:
                  - generic "2026-10-12" [ref=f1e295]
                  - generic "2026-10-13" [ref=f1e296]
                  - generic "2026-10-14" [ref=f1e297]
                  - generic "2026-10-15" [ref=f1e298]
                  - generic "2026-10-16" [ref=f1e299]
                  - generic "2026-10-17" [ref=f1e300]
                  - generic "2026-10-18" [ref=f1e301]
                - generic [ref=f1e302]:
                  - generic "2026-10-19" [ref=f1e303]
                  - generic "2026-10-20" [ref=f1e304]
                  - generic "2026-10-21" [ref=f1e305]
                  - generic "2026-10-22" [ref=f1e306]
                  - generic "2026-10-23" [ref=f1e307]
                  - generic "2026-10-24" [ref=f1e308]
                  - generic "2026-10-25" [ref=f1e309]
                - generic [ref=f1e310]:
                  - generic "2026-10-26" [ref=f1e311]
                  - generic "2026-10-27" [ref=f1e312]
                  - generic "2026-10-28" [ref=f1e313]
                  - generic "2026-10-29" [ref=f1e314]
                  - generic "2026-10-30" [ref=f1e315]
                  - generic "2026-10-31" [ref=f1e316]
                  - generic "2026-11-01" [ref=f1e317]
                - generic [ref=f1e318]:
                  - generic "2026-11-02" [ref=f1e319]
                  - generic "2026-11-03" [ref=f1e320]
                  - generic "2026-11-04" [ref=f1e321]
                  - generic "2026-11-05" [ref=f1e322]
                  - generic "2026-11-06" [ref=f1e323]
                  - generic "2026-11-07" [ref=f1e324]
                  - generic "2026-11-08" [ref=f1e325]
            - region "Shortcuts" [ref=f1e326]:
              - link [ref=f1e327] [cursor=pointer]:
                - /url: /student/practice
                - paragraph [ref=f1e331]: Practice
                - paragraph [ref=f1e332]: Solve problems
              - link [ref=f1e333] [cursor=pointer]:
                - /url: /student/interviews
                - paragraph [ref=f1e337]: Interviews
                - paragraph [ref=f1e338]: Real experiences
              - link [ref=f1e339] [cursor=pointer]:
                - /url: /student/resume
                - paragraph [ref=f1e343]: Resume
                - paragraph [ref=f1e344]: Build and print
              - link [ref=f1e345] [cursor=pointer]:
                - /url: /student/tasks
                - paragraph [ref=f1e349]: My tasks
                - paragraph [ref=f1e350]: Your to-do list
  - region "Cookie choices" [ref=f1e351]:
    - generic [ref=f1e352]:
      - generic [ref=f1e357]:
        - paragraph [ref=f1e358]: Cookies on AetherCode
        - paragraph [ref=f1e359]:
          - text: Essential cookies keep you signed in. With your OK we also remember your preferences and count visits.
          - link "Read more" [ref=f1e360] [cursor=pointer]:
            - /url: /privacy#cookies
      - generic [ref=f1e361]:
        - button "Accept all" [ref=f1e362]
        - button "Essential only" [ref=f1e363]
      - button "Choose what to allow" [ref=f1e364]
  - region "Notifications alt+T"
  - button "Open Next.js Dev Tools" [ref=f1e370] [cursor=pointer]
  - alert [ref=f1e374]
```

# Test source

```ts
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
  73  |   expect(failures, failures.join("\n")).toEqual([]);
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
> 132 |     expect(new URL(page.url()).pathname, `${path} must not open for a student`).not.toMatch(/^\/(admin|staff|placement)/);
      |                                                                                     ^ Error: /admin must not open for a student
  133 |     await page.close();
  134 |   }
  135 | });
  136 | 
```