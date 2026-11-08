# AetherCode API Reference

All endpoints are served through the gateway at `{PUBLIC_ORIGIN}/api/{service}/...`.
Authentication: Bearer token in the `Authorization` header. The frontend proxies
`/api/*` and adds the bearer from the session cookie automatically.

Every mutating endpoint (POST, PUT, PATCH, DELETE) requires an `Idempotency-Key`
header unless stated otherwise. All tenant-scoped paths include `{tenant_id}` as
a UUID path parameter. Responses use `application/json` with the `Problem` error
shape (`{code, message}`) on failure. `Cache-Control: no-store` is set on all
JSON responses.

The authoritative source for each endpoint's request/response schema is the
service's `api/openapi.yaml` file.

---

## Identity (`/api/identity/v1/...`)

Authentication, MFA, password management and single sign-on. Token endpoints
(`/v1/auth/*`) are not exposed through the frontend API proxy; the frontend
manages sessions server-side.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/auth/register` | Register a pending-verification principal |
| POST | `/v1/auth/verify-email` | Consume a one-time email-verification token |
| POST | `/v1/auth/login` | Authenticate with email and password |
| POST | `/v1/auth/mfa/verify-login` | Complete an MFA login challenge |
| POST | `/v1/auth/refresh` | Rotate a refresh token |
| POST | `/v1/auth/logout` | Revoke the refresh-token family |
| POST | `/v1/auth/password-reset` | Create a password-reset delivery token |
| POST | `/v1/auth/password-reset/complete` | Reset password and revoke active sessions |
| POST | `/v1/auth/password` | Change password for the authenticated principal |
| POST | `/v1/auth/mfa/totp` | Start TOTP enrollment |
| POST | `/v1/auth/mfa/totp/{factor_id}/activate` | Activate a pending TOTP factor |
| DELETE | `/v1/auth/mfa/totp/{factor_id}` | Disable a TOTP factor with current-factor proof |
| POST | `/v1/auth/mfa/step-up` | Elevate session to MFA-verified |
| POST | `/v1/auth/sso/start` | Begin a single sign-on flow (ADR-0042) |
| POST | `/v1/auth/sso/callback` | Exchange provider's authorization code for a session |
| GET | `/v1/principals/{id}` | Read the authenticated principal's own record |
| DELETE | `/v1/principals/{id}` | Soft-delete the authenticated principal's own account |

---

## Tenant (`/api/tenant/v1/...`)

Multi-tenant college management, placement organizations, departments, batches,
retention policies and legal holds.

### Colleges

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tenants` | List all tenants (platform administrators) |
| POST | `/v1/tenants` | Provision a college tenant |
| GET | `/v1/tenants/{tenant_id}` | Read a tenant |
| PATCH | `/v1/tenants/{tenant_id}` | Rename a college |
| DELETE | `/v1/tenants/{tenant_id}` | Soft-delete a tenant |
| DELETE | `/v1/tenants/{tenant_id}/hard` | Permanently delete a tenant |

### Departments and Batches

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tenants/{tenant_id}/departments` | List college departments |
| POST | `/v1/tenants/{tenant_id}/departments` | Create a college department |
| PATCH | `/v1/tenants/{tenant_id}/departments/{department_id}` | Edit department code or name |
| DELETE | `/v1/tenants/{tenant_id}/departments/{department_id}` | Soft-delete a department |
| DELETE | `/v1/tenants/{tenant_id}/departments/{department_id}/hard` | Permanently delete a department |
| GET | `/v1/tenants/{tenant_id}/batches` | List batches (filterable by department, academic year) |
| POST | `/v1/tenants/{tenant_id}/batches` | Create a batch in an active department |
| PATCH | `/v1/tenants/{tenant_id}/batches/{batch_id}` | Edit batch code, name or academic year |
| DELETE | `/v1/tenants/{tenant_id}/batches/{batch_id}` | Soft-delete a batch |
| DELETE | `/v1/tenants/{tenant_id}/batches/{batch_id}/hard` | Permanently delete a batch |

### Placement Organizations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/placement-organizations` | List placement organizations (global) |
| POST | `/v1/placement-organizations` | Create a placement organization |
| GET | `/v1/placement-organizations/{organization_id}` | Read a placement organization |
| PATCH | `/v1/placement-organizations/{organization_id}` | Rename a placement organization |
| DELETE | `/v1/placement-organizations/{organization_id}` | Soft-delete a placement organization |
| DELETE | `/v1/placement-organizations/{organization_id}/hard` | Permanently delete a placement organization |
| GET | `/v1/placement-organizations/{organization_id}/departments` | List placement departments |
| POST | `/v1/placement-organizations/{organization_id}/departments` | Create a placement department |

### Retention and Legal Holds

| Method | Path | Description |
|--------|------|-------------|
| PUT | `/v1/tenants/{tenant_id}/retention-policy` | Set tenant retention policy within platform bounds |
| POST | `/v1/tenants/{tenant_id}/legal-holds` | Place a legal hold (tenant, student, assessment or submission scope) |
| POST | `/v1/tenants/{tenant_id}/legal-holds/{hold_id}/release` | Release an active legal hold |

---

## User (`/api/user/v1/...`)

Accounts, students, roles, permissions and profiles.

### Self

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/me` | The caller's own active roles |
| PUT | `/v1/profiles/{principal_id}` | Create or update a principal profile |
| GET | `/v1/profiles/{principal_id}/public` | The caller's own public profile settings |
| PUT | `/v1/profiles/{principal_id}/public` | Publish, change or hide the caller's public profile |
| GET | `/v1/public/profiles/{slug}` | A public profile (no sign-in required) |

### Students

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tenants/{tenant_id}/students` | List students in a tenant |
| POST | `/v1/tenants/{tenant_id}/students` | Enroll a student with department affiliations |
| GET | `/v1/tenants/{tenant_id}/students/roster` | Staff roster with batch, departments, profile and mentors |
| GET | `/v1/tenants/{tenant_id}/students/{student_id}` | Read a student and current affiliations |
| PATCH | `/v1/tenants/{tenant_id}/students/{student_id}` | Edit enrolment number or admission date |
| DELETE | `/v1/tenants/{tenant_id}/students/{student_id}` | Soft-delete a student |
| DELETE | `/v1/tenants/{tenant_id}/students/{student_id}/hard` | Permanently delete a student |
| POST | `/v1/tenants/{tenant_id}/students/import` | Import students with generated passwords |
| GET | `/v1/tenants/{tenant_id}/students/{student_id}/batch-affiliation` | Read current batch affiliation |
| PUT | `/v1/tenants/{tenant_id}/students/{student_id}/batch-affiliation` | Set batch affiliation |
| POST | `/v1/tenants/{tenant_id}/students/{student_id}/batch-affiliation/revoke` | Revoke batch affiliation |

### Role Assignments

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/role-assignments` | List role assignments (filterable by tenant, principal, role, scope) |
| POST | `/v1/role-assignments` | Grant a scoped canonical role |
| POST | `/v1/role-assignments/{role_assignment_id}/revoke` | Revoke an active role assignment |
| PUT | `/v1/placement-departments/{placement_department_id}/staff/{principal_id}` | Create or reactivate placement staff membership |
| GET | `/v1/tenants/{tenant_id}/batches/{batch_id}/mentors` | List mentor assignments for a batch |
| PUT | `/v1/tenants/{tenant_id}/batches/{batch_id}/mentors/{principal_id}` | Assign a mentor to a batch |

### Account Management

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/tenants/{tenant_id}/staff` | Create a staff account (admin or faculty) |
| POST | `/v1/tenants/{tenant_id}/batches/{batch_id}/passwords` | Reissue every password in a batch |
| POST | `/v1/tenants/{tenant_id}/accounts/{principal_id}/password` | Reset one account's password |
| PUT | `/v1/tenants/{tenant_id}/accounts/{principal_id}/status` | Enable or disable one account |
| POST | `/v1/tenants/{tenant_id}/accounts/bulk-status` | Enable or disable multiple accounts |
| POST | `/v1/tenants/{tenant_id}/accounts/bulk-password` | Reset passwords for multiple accounts |
| POST | `/v1/tenants/{tenant_id}/accounts/describe` | Describe accounts by principal IDs |
| GET | `/v1/tenants/{tenant_id}/staff-audit` | College staff action audit log |

### Permissions and Roles (ADR-0066)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/permission-catalogue` | All grantable permissions (service.resource.verb) |
| GET | `/v1/permission-flags` | All named permission flags the roles engine knows |
| GET | `/v1/tenants/{tenant_id}/staff/{principal_id}/permissions` | A staff member's extra permissions in one college |
| PUT | `/v1/tenants/{tenant_id}/staff/{principal_id}/permissions` | Replace a staff member's college permissions |
| GET | `/v1/staff/{principal_id}/permissions` | Platform-wide extra permissions (root only) |
| PUT | `/v1/staff/{principal_id}/permissions` | Replace platform-wide extra permissions (root only) |
| GET | `/v1/tenants/{tenant_id}/roles` | List college-defined roles |
| POST | `/v1/tenants/{tenant_id}/roles` | Create a custom college role |
| PATCH | `/v1/tenants/{tenant_id}/roles/{role_id}` | Update a role's name, position or permissions |
| DELETE | `/v1/tenants/{tenant_id}/roles/{role_id}` | Delete a custom college role |
| GET | `/v1/tenants/{tenant_id}/role-overwrites` | List role permission overwrites |
| PUT | `/v1/tenants/{tenant_id}/role-overwrites` | Create or replace a permission overwrite |
| DELETE | `/v1/tenants/{tenant_id}/role-overwrites/{overwrite_id}` | Delete a permission overwrite |

---

## Question Bank (`/api/question-bank/v1/...`)

Question authoring, versioning, categories, model-solution checks, and practice.

### Questions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/questions` | List published questions (tenant-scoped) |
| POST | `/v1/questions` | Create a question aggregate |
| GET | `/v1/questions/{question_id}` | Read a published question |
| DELETE | `/v1/questions/{question_id}` | Soft-delete a question |
| DELETE | `/v1/questions/{question_id}/hard` | Permanently delete a question |
| POST | `/v1/questions/{question_id}/archive` | Archive a question |
| PUT | `/v1/questions/{question_id}/category` | File under a category without a new version |
| PUT | `/v1/questions/{question_id}/tags` | Replace tags without a new version |
| PUT | `/v1/questions/{question_id}/audience` | Set practice or exam audience |

### Question Versions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/questions/{question_id}/versions` | List versions of a question |
| POST | `/v1/questions/{question_id}/versions` | Create a new draft version |
| GET | `/v1/question-versions/{question_version_id}` | Read a question version |
| PATCH | `/v1/question-versions/{question_version_id}` | Edit draft title, statement, difficulty or limits |
| DELETE | `/v1/question-versions/{question_version_id}` | Soft-delete a version |
| DELETE | `/v1/question-versions/{question_version_id}/hard` | Permanently delete a draft version |
| PUT | `/v1/question-versions/{question_version_id}/tests` | Replace test cases for a draft |
| POST | `/v1/question-versions/{question_version_id}/assets` | Upload an asset (statement image) |
| GET | `/v1/question-versions/{question_version_id}/assets/{asset_kind}` | Download a named asset |
| PUT | `/v1/question-versions/{question_version_id}/tags` | Replace version-level tags |
| POST | `/v1/question-versions/{question_version_id}/publish` | Publish a draft (requires passing model check) |
| POST | `/v1/question-versions/{question_version_id}/request-review` | Request a review (ADR-0044) |
| GET | `/v1/question-versions/{question_version_id}/export` | Export with all tests (ADR-0032) |
| PUT | `/v1/question-versions/{question_version_id}/choices` | Make a draft multiple-choice (ADR-0035) |
| GET | `/v1/question-versions/{question_version_id}/templates` | Get code stubs and wrappers |
| PUT | `/v1/question-versions/{question_version_id}/templates` | Replace code templates |

### Model Checks

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/question-versions/{question_version_id}/model-checks` | Run a reference solution on all tests (ADR-0033) |
| GET | `/v1/question-versions/{question_version_id}/model-checks` | List model checks for a version |

### Categories and Tags

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/categories` | All categories with question counts |
| POST | `/v1/categories` | Add a category |
| PATCH | `/v1/categories/{category_id}` | Rename or move a category |
| DELETE | `/v1/categories/{category_id}` | Delete a category (questions move to fallback) |
| GET | `/v1/tags` | Tags in use, most-used first |
| GET | `/v1/review-policy` | Whether publishing needs a review |
| GET | `/v1/languages` | Languages an author may offer |

### Practice (ADR-0041)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tenants/{tenant_id}/practice/questions` | Practice catalogue with student progress |
| GET | `/v1/tenants/{tenant_id}/practice/progress` | Student's practice totals |
| GET | `/v1/tenants/{tenant_id}/practice/questions/{question_id}` | One problem with sample tests |
| GET | `/v1/tenants/{tenant_id}/practice/questions/{question_id}/submissions` | Student's last 20 runs |
| POST | `/v1/tenants/{tenant_id}/practice/questions/{question_id}/submissions` | Run or submit code |
| GET | `/v1/tenants/{tenant_id}/practice/submissions/{submission_id}` | One run with code |

---

## Assessment (`/api/assessment/v1/...`)

Exam authoring, versioning, publication, and candidate assignment.

### Proctor Policies

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tenants/{tenant_id}/proctor-policies` | List proctor policies |
| POST | `/v1/tenants/{tenant_id}/proctor-policies` | Create a proctor policy |
| GET | `/v1/tenants/{tenant_id}/proctor-policies/{proctor_policy_id}` | Read a proctor policy |
| GET | `/v1/tenants/{tenant_id}/proctor-policies/{proctor_policy_id}/versions` | List policy versions |
| POST | `/v1/tenants/{tenant_id}/proctor-policies/{proctor_policy_id}/versions` | Create a draft policy version |
| GET | `/v1/tenants/{tenant_id}/proctor-policy-versions/{proctor_policy_version_id}` | Read a policy version |
| POST | `/v1/tenants/{tenant_id}/proctor-policy-versions/{proctor_policy_version_id}/publish` | Publish a draft policy version |

### Exams

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tenants/{tenant_id}/exams` | List exams |
| POST | `/v1/tenants/{tenant_id}/exams` | Create an exam |
| GET | `/v1/tenants/{tenant_id}/exams/{exam_id}` | Read an exam |
| PATCH | `/v1/tenants/{tenant_id}/exams/{exam_id}` | Update external reference |
| DELETE | `/v1/tenants/{tenant_id}/exams/{exam_id}` | Soft-delete an exam |
| DELETE | `/v1/tenants/{tenant_id}/exams/{exam_id}/hard` | Permanently delete a draft exam |

### Exam Versions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tenants/{tenant_id}/exams/{exam_id}/versions` | List versions of an exam |
| POST | `/v1/tenants/{tenant_id}/exams/{exam_id}/versions` | Create a draft exam version |
| GET | `/v1/tenants/{tenant_id}/exam-versions/{exam_version_id}` | Read an exam version |
| PATCH | `/v1/tenants/{tenant_id}/exam-versions/{exam_version_id}` | Edit title, instructions, window or duration |
| GET | `/v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/content` | Sections, items and assignment rules |
| POST | `/v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/publish` | Publish a complete draft |

### Exam Structure

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/sections` | Add a section (or pool with draw_count) |
| PATCH | `/v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/sections/{section_id}` | Edit section title, instructions or time limit |
| DELETE | `/v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/sections/{section_id}` | Remove a section |
| POST | `/v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/sections/{section_id}/items` | Snapshot a question into a section |
| PATCH | `/v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/sections/{section_id}/items/{item_id}` | Change marks |
| DELETE | `/v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/sections/{section_id}/items/{item_id}` | Remove a question item |
| POST | `/v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/items/{item_id}/repin` | Repin to a corrected question version (ADR-0039) |

### Assignments

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/assignment-rules` | Create an assignment rule |
| POST | `/v1/tenants/{tenant_id}/assignment-rules/{assignment_rule_id}/candidate-assignments` | Materialize a direct student assignment |
| POST | `/v1/tenants/{tenant_id}/assignment-rules/{assignment_rule_id}/window` | Move the close time of a live rule |
| GET | `/v1/tenants/{tenant_id}/candidate-assignments` | List candidate's own assignments |
| GET | `/v1/tenants/{tenant_id}/candidate-assignments/{candidate_assignment_id}` | Read one assignment |
| POST | `/v1/tenants/{tenant_id}/candidate-assignments/{candidate_assignment_id}/revoke` | Revoke an assignment |

---

## Submission (`/api/submission/v1/...`)

Exam attempts, code execution, grading, monitoring and results.

### Attempts

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tenants/{tenant_id}/attempts` | List the candidate's attempts |
| POST | `/v1/tenants/{tenant_id}/attempts` | Start an assignment-backed attempt |
| GET | `/v1/tenants/{tenant_id}/attempts/{attempt_id}` | Read an attempt |
| DELETE | `/v1/tenants/{tenant_id}/attempts/{attempt_id}` | Soft-delete an attempt |
| DELETE | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/hard` | Permanently delete an attempt |
| GET | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/paper` | The exam paper (owner and SEB-locked) |
| GET | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/answers` | List answer revisions |
| PUT | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/answers/{exam_item_id}` | Save an answer revision |
| PUT | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/choices/{exam_item_id}` | Save a multiple-choice selection |
| POST | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/submit` | Submit attempt for grading |
| POST | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/events` | Record an integrity event (ADR-0037) |

### Code Execution

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/items/{exam_item_id}/runs` | Run code against sample tests |
| GET | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/items/{exam_item_id}/runs` | List runs, newest first |
| GET | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/runs/{run_id}` | One run with sample test output |
| POST | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/items/{exam_item_id}/submissions` | Submit code against all tests |
| GET | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/items/{exam_item_id}/submissions` | List evaluations, newest first |

### Student Results

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/live` | Current deadline and announcements |
| GET | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/result` | Score (after result release) |
| GET | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/unit-results` | Per-unit breakdown (owner) |

### Staff Operations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/monitor` | Live exam monitor |
| PUT | `/v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/results-release` | Show or hide results to candidates |
| POST | `/v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/extensions` | Add time to attempts |
| POST | `/v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/announcements` | Send a message to all candidates |
| PUT | `/v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/integrity` | Require fullscreen, block pastes (ADR-0037) |
| GET | `/v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/similarity` | Code similarity report (ADR-0031) |
| GET | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/review` | Staff review of one attempt (ADR-0029) |
| GET | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/judge-receipts` | Per-unit judge receipts (staff) |
| GET | `/v1/tenants/{tenant_id}/grading-queue` | Current grading queue |
| POST | `/v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/items/{exam_item_id}/regrade` | Re-evaluate all answers to one item (ADR-0039) |

---

## SEB (`/api/seb/v1/...`)

Safe Exam Browser configuration, session management, lockdown enforcement and
launch-file generation.

### Configurations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tenants/{tenant_id}/configurations` | List SEB configurations |
| POST | `/v1/tenants/{tenant_id}/configurations` | Register encrypted SEB configuration metadata |
| GET | `/v1/tenants/{tenant_id}/configurations/{configuration_id}` | Read a configuration |
| GET | `/v1/tenants/{tenant_id}/configurations/{configuration_id}/payload` | Download raw decrypted payload |
| POST | `/v1/tenants/{tenant_id}/configurations/{configuration_id}/rotate` | Retire and atomically replace |
| POST | `/v1/tenants/{tenant_id}/configurations/{configuration_id}/revoke` | Immediately revoke |
| DELETE | `/v1/tenants/{tenant_id}/configurations/{configuration_id}` | Soft-delete |
| DELETE | `/v1/tenants/{tenant_id}/configurations/{configuration_id}/hard` | Permanently delete |

### Sessions and Validation

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tenants/{tenant_id}/sessions` | List SEB sessions for the candidate |
| POST | `/v1/tenants/{tenant_id}/sessions` | Issue an attempt-bound SEB session |
| GET | `/v1/tenants/{tenant_id}/sessions/{session_id}` | Read a session |
| POST | `/v1/tenants/{tenant_id}/sessions/{session_id}/close` | Close a session |
| POST | `/v1/tenants/{tenant_id}/sessions/{session_id}/validate` | Validate SEB header and append audit |
| POST | `/v1/tenants/{tenant_id}/request-checks` | Check a request for SEB (gateway only) |

### Exam Lockdown

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tenants/{tenant_id}/exams/{exam_id}/seb-policy` | Read exam's SEB lock (staff) |
| PUT | `/v1/tenants/{tenant_id}/exams/{exam_id}/seb-policy` | Lock or unlock an exam to SEB (staff) |
| GET | `/v1/tenants/{tenant_id}/exams/{exam_id}/seb-policy/launch-file` | Download .seb launch file (staff) |
| GET | `/v1/tenants/{tenant_id}/exams/{exam_id}/launch-file` | Download .seb launch file (candidate) |

---

## Notification (`/api/notification/v1/...`)

Encrypted notifications, delivery preferences and community content.

### Notifications

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tenants/{tenant_id}/me/notifications` | List the caller's notifications |
| POST | `/v1/tenants/{tenant_id}/notifications` | Schedule one encrypted notification |
| POST | `/v1/tenants/{tenant_id}/notifications/{notification_id}/cancel` | Cancel a pending notification |
| DELETE | `/v1/tenants/{tenant_id}/notifications/{notification_id}` | Soft-delete a notification |
| DELETE | `/v1/tenants/{tenant_id}/notifications/{notification_id}/hard` | Permanently delete a notification |

### Preferences

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tenants/{tenant_id}/me/preferences` | List notification preferences |
| PUT | `/v1/tenants/{tenant_id}/me/preferences/in-app` | Update in-app preference |
| PUT | `/v1/tenants/{tenant_id}/me/preferences/email` | Update email preference |
| PUT | `/v1/tenants/{tenant_id}/me/preferences/sms` | Update SMS preference |

### Community (ADR-0048)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tenants/{tenant_id}/community/interview-experiences` | List interview experiences |
| POST | `/v1/tenants/{tenant_id}/community/interview-experiences` | Submit an experience |
| DELETE | `/v1/tenants/{tenant_id}/community/interview-experiences/{id}` | Delete own experience |
| GET | `/v1/tenants/{tenant_id}/community/posts` | List community posts |
| GET | `/v1/tenants/{tenant_id}/community/posts/{id}` | Read a post |
| GET | `/v1/tenants/{tenant_id}/community/feed` | Community feed (contests, hackathons, etc.) |
| PUT | `/v1/tenants/{tenant_id}/community/feed/{id}/bookmark` | Bookmark a feed item |
| GET | `/v1/tenants/{tenant_id}/community/profile-links` | Get profile links |
| PUT | `/v1/tenants/{tenant_id}/community/profile-links/{platform}` | Set a profile link |
| GET | `/v1/tenants/{tenant_id}/community/tasks` | List personal tasks |
| POST | `/v1/tenants/{tenant_id}/community/tasks` | Create a task |
| PATCH | `/v1/tenants/{tenant_id}/community/tasks/{id}` | Update a task |
| DELETE | `/v1/tenants/{tenant_id}/community/tasks/{id}` | Delete a task |

### Community Moderation (staff)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tenants/{tenant_id}/community/moderation/interview-experiences` | Review queue |
| POST | `/v1/tenants/{tenant_id}/community/moderation/interview-experiences/{id}/review` | Approve or reject |
| GET | `/v1/tenants/{tenant_id}/community/moderation/posts` | Manage posts |
| PUT | `/v1/tenants/{tenant_id}/community/moderation/posts` | Save a post |
| DELETE | `/v1/tenants/{tenant_id}/community/moderation/posts/{id}` | Delete a post |
| PUT | `/v1/tenants/{tenant_id}/community/moderation/feed` | Save a feed item |
| DELETE | `/v1/tenants/{tenant_id}/community/moderation/feed/{id}` | Delete a feed item |

---

## Analytics (`/api/analytics/v1/...`)

Event-fed, tenant-scoped reporting read models and durable export requests.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tenants/{tenant_id}/student-progress/{student_id}` | Question progress for a student |
| GET | `/v1/tenants/{tenant_id}/exam-results` | Completed attempts for an exam version (query: `exam_version_id`) |
| GET | `/v1/tenants/{tenant_id}/batch-progress/{batch_id}` | Exam progress per batch |
| GET | `/v1/tenants/{tenant_id}/batch-progress/{batch_id}/by-department` | Department-sliced batch progress |
| GET | `/v1/tenants/{tenant_id}/placement-progress/{placement_department_id}` | Latest attempt per affiliated student |
| POST | `/v1/tenants/{tenant_id}/report-exports` | Request a durable report export (Idempotency-Key required) |
| GET | `/v1/tenants/{tenant_id}/report-exports/{export_id}` | Current export status (storage keys omitted) |
| DELETE | `/v1/tenants/{tenant_id}/report-exports/{export_id}` | Soft-delete a report export |
| DELETE | `/v1/tenants/{tenant_id}/report-exports/{export_id}/hard` | Permanently delete (blocked by legal holds) |

---

## Common Patterns

- **Pagination**: List endpoints use keyset cursors (`?limit=20&cursor=<opaque>`). The response includes `next_cursor` when more pages exist.
- **Optimistic concurrency**: Mutations include `expected_version` or `expected_content_version` to prevent lost updates. A version mismatch returns `409 Conflict`.
- **Soft/hard delete**: Soft-delete sets `deleted_at` and is reversible. Hard delete (`/hard`) is permanent and requires a `reason` in the body. Legal holds block hard deletes.
- **Error shape**: `{"code": "invalid_argument", "message": "..."}` with HTTP status codes: 400 (invalid), 401 (unauthenticated), 403 (forbidden), 404 (not found), 409 (conflict), 412 (precondition failed), 503 (unavailable with `Retry-After`).
- **SEB protection**: Student exam endpoints require Safe Exam Browser request hashes validated by the gateway against the SEB service.
