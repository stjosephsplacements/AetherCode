# Roles, scopes and what each can do

AetherCode has six assignable roles. Each assignment has a **scope** (where it applies). Access is
decided centrally by the User service from the role's permission bits, per-resource overwrites and
the scope; the web app only decides which area to show. Source of truth: `users.roles`,
`users.permission_flags` and `backend/libs/pkg/authz/role.go`.

| Role | Scope | Guild (tier) | Who it is for | Home |
|---|---|---|---|---|
| Owner (`super_admin`, self-granted) | platform | platform (3) | The person who runs the deployment. Holds every permission. | `/admin` |
| Super admin (`super_admin`, delegated) | platform | platform (3) | Platform staff the owner delegates to. Gets only what the permission editor grants, plus platform internals. | `/admin` |
| Placement officer (`placement_user`) | platform or placement department | placement (3) | The placements and training cell: placement pool, drives, cross-college questions and exams. | `/placement` |
| College admin (`college_admin`) | college | college (2) | A college's administrator: departments, batches, staff, roles, students, exams, results. | `/staff` |
| Department user (`department_user`) | department | college (2) | Faculty or a department coordinator: questions, exams and results for their department. | `/staff` |
| Mentor (`mentor`) | department or batch | college (1) | A teacher who follows students' progress. Read-oriented. | `/staff` |
| Student (`student`) | self | college (1) | Candidates. Can only see and change their own records. | `/student` |

Every member also holds the implicit `everyone` role of their guild (the baseline all members share).
Higher tiers outrank lower ones in the role editor: a non-root actor must stay below their own highest role. The root (owner) may manage unmanaged roles; managed roles (Owner, Super admin, Placement officer and the built-in college roles) cannot be edited.

## Permission flags

Role permission bits, edited at `/staff/roles` and `/staff/permissions`:

| Flag | Allows |
|---|---|
| `ADMINISTRATOR` | Everything in scope; bypasses overwrites. |
| `VIEW_SCOPE` | See the scope's records (students, exams, results). |
| `MANAGE_ROLES` | Create and edit roles below your own. |
| `MANAGE_OVERWRITES` | Change per-resource permission overwrites. |
| `MANAGE_MEMBERS` | Add, import, deactivate and reset members (students, staff). |
| `MANAGE_STRUCTURE` | Departments, batches and organisation settings. |
| `VIEW_AUDIT` | Read the audit log. |
| `VIEW_STUDENT_PII` | Opens the PII-gated resources, such as proctoring evidence (each read is audited). Ordinary student records are governed by `VIEW_SCOPE` and the per-resource permissions. |
| `VIEW_PLACEMENT_POOL` / `MANAGE_PLACEMENT` | See and run placement drives and pools. |
| `EXPORT_DATA` | Download CSV exports. |
| `VIEW_GOLD_ANALYTICS` | Cross-cutting analytics dashboards. |
| `<service>.<resource>.read/write/delete` | Per-resource access, for example `assessment.exams.write`. |

Writing needs reading: granting a write in the role editor also grants its matching read, and a write without its read is ignored when permissions are resolved. A delete is a write to the databases and is recorded as a delete in the audit log.
Permission changes are limited to root and the college's administrators.

## Areas and what they are for

### Student (`/student`)
| Page | Use |
|---|---|
| `get-started`, `help` | First-time guide and help centre. |
| `exams`, `exams/[assignmentId]`, `scheduled`, `completed` | Upcoming, running and finished exams; start an exam. |
| `/exam/[examId]` | The exam screen: editor, Run on samples, custom input, Submit per question, autosave, server timer, auto-submit at time-up, Safe Exam Browser when required. |
| `attempts/[attemptId]`, `results/[attemptId]`, `my-results` | Review an attempt and see released results with per-test verdicts. |
| `practice`, `practice/topics/[topic]`, `practice/[questionId]` | Practice problems outside exams. |
| `performance`, `progress` | Their own analytics and progress. |
| `interviews`, `blogs`, `contests`, `hackathons`, `open-source` | Community content and external opportunities (open-source *issues* to contribute to). |
| `profile`, `resume`, `tasks` | Profile, linked coding accounts, resume and a task list. |

### Staff (`/staff`): college admin, department user, mentor
| Page | Use | Typical roles |
|---|---|---|
| `students`, `students/[studentId]` | Import (CSV), view and manage students and batches. | College admin, department user |
| `departments`, `organisation` | Departments, batches, college settings. | College admin |
| `accounts` | Staff accounts. | College admin |
| `roles`, `permissions` | Edit roles and permission grants. | College admin |
| `questions`, `questions/new`, `questions/[versionId]` | Author coding and multiple-choice questions with sample and hidden tests. A model solution must pass every test before publishing. | Department user, college admin |
| `exams`, `exams/new`, `exams/[examId]` | Build and schedule exams, question pools, assignment rules, proctor policy. | Department user, college admin |
| `exams/[examId]/preview`, `.../try/[assignmentId]` | Preview an exam, or try it as a candidate. | Same |
| `exams/[examId]/monitor` | Live monitor: who is in, progress, violations. Extra-time and recovery actions. | Invigilators with `VIEW_SCOPE` |
| `exams/[examId]/results`, `.../attempts/[attemptId]`, `.../similarity` | Results, per-attempt review, similarity report, CSV export, release of results. | Same, `EXPORT_DATA` for export |
| `analytics`, `calendar`, `community`, `audit`, `status` | Analytics, the exam calendar, moderating community content, the audit log, service status. | By permission |
| `get-started`, `help` | Staff guide and help. | All staff |

Mentors normally hold read permissions only: they see students and results in their scope but do not author or schedule.

### Placement (`/placement`): placement officer
| Page | Use |
|---|---|
| `departments`, `staff` | Placement departments and the staff in them. |
| `questions`, `exams` | Shared questions and exams across colleges for placement drives. |
| `analytics` | Placement-pool analytics (`VIEW_PLACEMENT_POOL`, `VIEW_GOLD_ANALYTICS`). |

### Admin (`/admin`): owner and super admin
| Page | Use |
|---|---|
| `colleges` | Create and manage college tenants. |
| `admins` | Platform administrators and delegation. |
| `analytics`, `audit`, `incidents`, `status` | Platform-wide analytics, the audit log, incident handling and service health. |

## Signing in and recovery
- Every role signs in at `/login`. Staff accounts can enrol an authenticator (TOTP); sensitive actions ask again (step-up).
- Students receive an initial password from staff import and must change it on first sign-in.
- Forgotten passwords: staff reset them (`MANAGE_MEMBERS`), and the operator can deliver an administrator's reset token out of band (see SELF-HOSTING.md). There is no email self-service in this release.
