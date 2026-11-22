# ADR-0092: College-scoped practice contests

- Status: accepted
- Date: 2026-11-22

## Context

The reference product runs timed coding contests. Our community feed already lists external Codeforces events (ADR-0048), but colleges need their own timed contests built from the **practice** question bank: registration, a live window, and a college-only leaderboard. This is not a global marketplace and not an exam (no SEB, no hidden grading queue for course credit).

## Decision

Add `qbank.college_contests` and `qbank.college_contest_registrations` in the question-bank service database. Each contest belongs to one `tenant_id`, references one or more practice question IDs, has `starts_at` / `ends_at`, and moves `scheduled` → `live` → `ended` by wall clock (no separate worker in the MVP).

Staff with question-bank write in the college create and publish contests. Students register while the contest is `scheduled` or `live` before `ends_at`. Submissions reuse `qbank.practice_submissions` with `mode = submit`; the leaderboard counts **accepted** submits on contest questions whose `completed_at` falls inside `[starts_at, ends_at]`, ordered by problems solved then earliest last solve.

HTTP (question-bank):

- `GET /v1/tenants/{tenant_id}/contests` — list (students: registered + open; staff: all)
- `POST /v1/tenants/{tenant_id}/contests` — create (staff)
- `GET /v1/tenants/{tenant_id}/contests/{contest_id}` — detail
- `POST /v1/tenants/{tenant_id}/contests/{contest_id}/register` — student self
- `GET /v1/tenants/{tenant_id}/contests/{contest_id}/leaderboard` — live standings

The student UI adds a Contests hub for college events (separate from the community feed). Staff manage contests under Practice → Contests.

## Consequences

- One additive migration in question-bank; new RBAC flags `qbank.college_contests.*`.
- Leaderboard is derived from existing practice submissions; contest questions must stay on `audience = practice`.
- No cross-college visibility; no billing or plans.
- Follow-ups: auto-notifications at start/end, per-contest custom scoring, department filters.