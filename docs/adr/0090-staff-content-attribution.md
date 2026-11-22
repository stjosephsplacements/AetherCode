# ADR-0090: Staff-visible content attribution

## Status

Accepted (2026-11-22)

## Context

Creator principal IDs (`created_by` / `author_id`) were stored on questions, exams,
community posts, feed listings and announcements, but almost never returned by
APIs or shown in the UI. Frozen `apps/exam-v1` already showed question authors
by name. Placement and multi-officer colleges need to see who authored what.

## Decision

1. **Staff, placement and admin surfaces** show a resolved display name for the
   creator of each authored row (question version, exam / exam version, blog
   post, feed listing, staff monitor announcement, interview experience under
   moderation).
2. **Interview experiences stay anonymous to students.** `author_id` remains
   staff-only in community JSON, as before.
3. **APIs expose principal UUIDs**; the BFF resolves names with
   `POST /user/v1/tenants/{t}/accounts/describe` (existing ADR-0043 helper).
   Services do not join User for display names.
4. **Student exam and practice UIs do not show authors.** Candidate live
   announcements omit `created_by`.

## Consequences

- Migrations: question-bank `000032`, assessment `000042`, notification
  `000019`, submission `000051`.
- Applying these on campus is owner-run (AGENTS.md schema ask-first).
- Name lookup fails soft to an em dash when describe is unavailable.
