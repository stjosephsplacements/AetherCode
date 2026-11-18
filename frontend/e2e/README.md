# End-to-end tests

Playwright specs for every role: platform administrator, college staff, department user and student. They run against a
live platform (real gateway, databases and judge), so run them against a staging or otherwise disposable deployment.

## Setup

1. **A dedicated college.** The specs create batches, students, questions and exams. Create a small college for them and
   select it with `E2E_TENANT_SLUG=<slug>` (default: the first college). Do not point them at a college with thousands of
   students: the roster loads at most 5000 rows.
2. **Administrator credentials** in `~/aethercode-admin.txt` (or `E2E_ADMIN_FILE`): `email password totp-secret`, one line,
   mode 600. Elevated actions need a fresh second factor, so the account needs a TOTP authenticator whose secret is the
   third word. Disable that authenticator and delete the file when you are done.
3. **A tunnel to the gateway only**, on `127.0.0.1:8380` (the specs call `http://127.0.0.1:8380/api`).
4. **A local production build of the frontend** whose public origin matches the test URL. The app refuses non-GET requests
   from any other origin ("Cross-site request refused"), so do not test through a tunnel to the real frontend, and do not use
   `next dev` (too slow for the timeouts):

   ```sh
   cd frontend
   export GATEWAY_URL=http://127.0.0.1:8380 PUBLIC_ORIGIN=http://127.0.0.1:8382
   npx next build && npx next start -p 8382
   ```

## Run

```sh
E2E_TENANT_SLUG=<slug> E2E_BASE_URL=http://127.0.0.1:8382 npx playwright test -c e2e
```

The full suite takes about 25 minutes (19 specs, one worker). One TOTP code can be used once per 30-second window, so do not
use the same authenticator for other calls while it runs.

| Spec | Covers |
|---|---|
| `areas`, `pages` | Each role's pages, area separation, a student cannot open staff or admin pages |
| `mfa`, `stepup` | Authenticator enrolment, sign-in with a second factor, step-up for elevated actions |
| `authoring`, `exam-authoring` | Writing questions, building and publishing an exam through the UI |
| `exam-flow`, `extra-time`, `results-export`, `exam-staff` | A student sits an exam (Run, Submit, auto-submit), staff monitor, extra time, results, CSV, similarity |
| `practice` | A student practises a question |
| `staff-ui` | Departments, enrolling and importing students |
| `community` | Interview experiences submitted and approved |
