# Getting started, by role

Short paths for each role. Each role also has an in-app guide at `/student/get-started`, `/staff/get-started`,
`/placement/get-started` and `/admin/get-started`; only the staff one tracks completion as a checklist. What each role may do is in
[ROLES.md](ROLES.md); installing the platform is in [SELF-HOSTING.md](SELF-HOSTING.md).

## Student
1. Sign in at `/login` with the email and initial password from your college. Change the password when asked.
2. Open `/system-check` on the lab computer before an exam: it checks the browser, screen and network.
3. Under **Exams**, open the exam when it is live. If it needs Safe Exam Browser, use the launch button on the exam page:
   it opens Safe Exam Browser, where you sign in again. If the button does not open it, download the configuration file
   from the same page and open it with Safe Exam Browser; your invigilator tells you if a password is needed.
4. In the editor choose a language, **Run** on the samples, try custom input, then **Submit** each question. Work saves
   automatically. The timer belongs to the server; the exam submits itself at time-up.
5. Results appear under **My results** once staff release them, with a verdict for each test.
6. Between exams, use **Practice**, **Performance**, **Interviews**, **Contests** and your **Profile**.

## Faculty (department user)
1. Sign in and open `/staff/get-started`.
2. **Questions**: write the statement, add sample and hidden tests, add a model solution and run the model check. A coding question
   publishes only when the model solution passes every test; a multiple-choice question needs its options and correct answer.
3. **Exams**: new exam, pick questions or pools, set the window, duration and languages, assign a batch, choose the proctor
   policy. Preview it, or try it as a candidate.
4. On exam day open **Monitor** to see who is in, progress and violations; grant extra time where policy allows.
5. After the exam, review **Results**, check the **Similarity** report and release results. Exporting the CSV needs the
   `EXPORT_DATA` permission.

Mentors have read access in their scope (students, progress and results) and do not author or schedule exams.

## College administrator
1. Sign in, change your password and enrol an authenticator app.
2. **Departments** and **Organisation**: create departments and batches.
3. **Students**: import the CSV and share initial passwords. Reset a forgotten password from the student's page.
4. **Accounts** and **Roles**: add faculty and give each the smallest role that works.
5. Review **Audit** after each exam. Branding and single sign-on are set by whoever runs the deployment (see
   [SELF-HOSTING.md](SELF-HOSTING.md)), not from the app.

## Placement officer
1. Sign in at `/login`; you land on `/placement`.
2. Set up placement departments and their staff.
3. Use the shared questions and exams for drives (the placement question bank is read-only; authoring needs a separate
   permission), and read the placement analytics.

## Platform administrator (owner)
1. Complete the first-administrator steps in the deployment guide; sign in and enrol an authenticator app.
2. **Colleges**: create each college and its first administrator.
3. Watch **Status** and **Incidents** during exams; use **Audit** for investigations.
4. Take and test backups; plan upgrades with the release checklist.
