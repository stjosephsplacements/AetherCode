# ADR-0059: Closing the remaining gaps with the reference product

- Status: proposed
- Date: 2026-11-02

## Context

The reference product (`siva0990/finalized-codepro`) was compared page by page and module
by module with this platform. This ADR records the whole comparison so nothing is missed, and
designs the three gaps that no other ADR covers.

## The comparison

| Reference area | Here | State |
| --- | --- | --- |
| Management: dashboard, analytics | Overview, Analytics, Platform analytics | Done, and ours adds live platform metrics |
| Colleges, departments, placements, roles, users | Colleges, Departments, Placements, Roles, Permissions, Staff accounts | Done, plus per-person permissions (ADR-0055) |
| Students: list, filters, sort, export, bulk, enrol, edit, delete | Students console | Done (this series); phone, password state, join date, mentor need ADR-0057 |
| Students: bulk upload | Bulk import and single enrol | Done |
| Users: bulk upload | Bulk add staff | Done (`feat/bulk-staff-import`) |
| Questions: programming and MCQ, categories, tags, hidden tests, template and upload of tests, library search, edit, delete | Questions library and wizard | Done; test upload and template added |
| Questions: sub-categories, option explanations | none | ADR-0058 |
| Review: pending reviews, assign questions to a reviewer | Review queue and assigned reviewer | Done |
| Tests, schedule, results, per-student result | Exams, Calendar, Results, Attempt review | Done, plus similarity and live monitor |
| Blogs, contests, hackathons, open source management | Community | Done (redesigned, paged) |
| Tasks, resume, profile, performance, practice | Student pages | Done |
| SEB start | SEB service | Done |
| Branding page: app name, logo carousel per college and global | Branding is a file read at deploy | Gap, designed below |
| Queue operations: metrics, failed jobs, requeue one or all | Grading queue counts and regrade | Gap, designed below |
| Scrapers dashboard: platform profiles, sync one student or everyone | Stats fetched live per student view | Gap, designed below |
| Stats: global health, content pulse, security audit | Platform analytics, Audit log, System status | Covered; no change |

## Decision

### 1. Branding managed in the console

Today `lib/branding.ts` reads a JSON file at deploy: a name, accent colour and logo file
names per college. Staff cannot change it, and a logo change is a deploy.

Add to the tenant service `tenant.branding (tenant_id nullable for the platform default,
app_name, accent_color, updated_by, updated_at)` and `tenant.branding_logos (id, tenant_id,
object_key, sha256, content_type, position, alt_text)`. Logos live in the object store the
platform already uses for avatars; the row keeps the key and checksum.

Routes: `GET /v1/branding` (public, the signed-out login page needs it, returns only name,
colour and logo URLs), `GET /v1/tenants/{t}/branding`, `PUT /v1/tenants/{t}/branding`
(name, colour), `POST /v1/tenants/{t}/branding/logos` (image, at most 1 MB, PNG, JPEG, WebP
or SVG, SVG sanitised and served with a strict content type), `PUT .../logos/order`,
`DELETE .../logos/{id}`. The platform default uses the same routes with the nil tenant and
needs a platform administrator; a college administrator edits only their own college.
Every change goes through the staff audit log. The web app reads branding per request with
a short cache, and the file stays as the fallback when the tables are empty, so existing
deployments change nothing.

### 2. Failed work visible and retryable

The grading queue shows counts only. Add to the submission service
`GET /v1/tenants/{t}/grading-queue/failed` (id, submission, attempt, error summary, attempts
so far, last failure time, newest first, paged), `POST .../failed/{id}/retry`,
`POST .../failed/retry-all` (capped at 500, one audit entry with the count) and
`DELETE .../failed/{id}` with a reason (ADR-0053). Retry puts the job back on the stream with
its attempt count reset and the same idempotency key, so a job that already succeeded in the
meantime is a no-op. The error summary is the judge's category and first line, never raw
output, so no candidate code reaches the page. The System status page gets a "Failed" tile
that opens the list.

### 3. Coding-platform profiles synced in the background

Students link handles (Codeforces, LeetCode and so on); the profile page fetches stats on
demand, so a staff view of many students would mean many outbound calls. Add a
`users.platform_stats (student_id, platform, handle, stats jsonb, fetched_at, status,
failure)` table and a worker that refreshes it on a schedule (default every 6 hours, jittered,
a few requests at a time with per-platform back-off). Routes: `GET /v1/tenants/{t}/platform-profiles`
(paged, filter by platform, status, batch; summary counts), `POST .../platform-profiles/sync`
(everyone in a college, rate limited to once per 10 minutes) and
`POST .../students/{id}/platform-profiles/sync`. The console gets a "Profiles" tab on
Analytics. Outbound calls leave only the public handle; a platform that rate limits us marks
rows `stale`, never `failed`, and the old numbers stay with their date.

## Order of work

1. ADR-0057 account summary and roster (unblocks the Students columns).
2. ADR-0058 sub-categories, then explanations.
3. This ADR: failed work (small, operational), branding, then profile sync.

## Consequences

- Three more migrations in tenant, submission and user, all additive.
- Branding becomes data, so it needs backup and the fallback file keeps first boot working.
- The profile worker adds outbound traffic; the schedule and limits are settings, not code.
- Tests: SVG sanitising and size limits for logos, tenant isolation for branding writes,
  retry idempotency, the failed list never containing source code, and the sync worker's
  back-off with a fake platform.
