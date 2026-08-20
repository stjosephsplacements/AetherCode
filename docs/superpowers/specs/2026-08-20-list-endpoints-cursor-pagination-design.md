# List Endpoints and Cursor Pagination — Design

Date: 2026-08-20
Status: approved for planning
Scope: sub-project C of the backend gap remediation sequence

## Problem

The platform is write-complete and read-blind. Across `tenant`, `user`,
`assessment`, `submission`, `question-bank`, and `seb` there are 70 routes, of
which exactly one is a collection route (`GET /v1/questions`); the other 69 are
mutations or get-by-id reads. A candidate has no API that answers "which exam am
I supposed to sit"; staff have no API that answers "who is in this batch".

The one existing collection route caps at `limit=100` with no cursor, so it
cannot page a tenant with 10,000 students.

## Goal

Add collection endpoints across the six services, with a single cursor
contract, without weakening tenant isolation and without exposing one
candidate's records to another.

Non-goals: filtering DSLs, full-text search, sorting by arbitrary columns,
`notification` and `analytics` (they already have bounded list routes),
aggregate counts.

## The security constraint that shapes everything

Row-level security in this codebase is **tenant-scoped, not owner-scoped**. The
generated read policy is:

```sql
CREATE POLICY ..._signed_read ON <table> FOR SELECT TO aether_submission_app
  USING (authz.current_context_allows_read(tenant_id, 'submission.read',
                                           'submission.write', <table>));
```

`authz.current_context_allows_read` takes a tenant and an action. It knows
nothing about row ownership
(`services/submission/migrations/000002_domain.up.sql:245`,
`services/submission/migrations/000001_bootstrap.up.sql:311`).

This is safe today only because every read route is get-by-id and the
authorization call binds a specific resource. A naive `GET /attempts` would let
any student holding `submission.read` enumerate every attempt in their college.

The codebase already has the sanctioned answer:
`authz.current_context_actor_id()`, introduced for this exact purpose in
`services/seb/migrations/000006_self_session_validation.up.sql:6` — "Bind
validation to the signed RLS actor rather than a caller-selected" id. It exists
in every platform database except `question-bank`, which holds tenant-global
content and has no per-actor rows.

**Design rule:** every collection endpoint is classified Class A or Class B, and
the class determines where scoping is enforced.

- **Class A (owner-scoped).** The caller may see only rows they own. The
  ownership predicate lives inside a `SECURITY DEFINER` function that filters on
  `authz.current_context_actor_id()`. The Go layer cannot express the query any
  other way, so the predicate cannot be forgotten.
- **Class B (tenant-scoped).** The caller is staff and may see every row in the
  tenant. A plain parameterised `SELECT` inside the RLS transaction is
  sufficient, matching the existing idiom at
  `services/assessment/internal/adapters/repo/postgres.go:526`.

Rejected alternative: enforcing ownership in Go by appending
`AND candidate_id = $n` in each repo method. One omission in one method silently
leaks every candidate's attempts tenant-wide, with only a tenant policy as
backstop. Not acceptable on an exam platform.

Deferred alternative: rewriting the SELECT policies to be owner-aware so every
query is scoped, existing routes included. This is the correct long-term shape,
but it changes the security model for code that currently works and needs the
integration harness (sub-project F) to verify. Class A does not block it — when
the policies become owner-aware, the Class A functions stay correct and become
redundant defence in depth.

## Authorization findings

Three findings from `services/user/internal/app/authorization.go` determine how
much of the User service this touches. The Casbin object string is
`"/" + ResourceType + "/" + ResourceID` (line 242), and candidate-facing routes
authorize with the bearer subject as the resource ID.

1. **Attempts need no User change.** `assignmentApplies` already has a `case
   "attempts"` branch permitting `ResourceID == ScopeID` (line ~390), and
   `services/user/migrations/000009_submission_attempt_self_policy.up.sql`
   already seeds `('student','self','/attempts/:id','read')`. A student listing
   their attempts authorizes as `attempts` / subject-UUID and passes today.

2. **Candidate assignments need a User code change.** The Casbin row
   `('student','self','/candidate_assignments/:id','read')` exists
   (`000008_candidate_self_policy.up.sql`), but `assignmentApplies` case
   `"candidate_assignments"` requires
   `ownedCandidateAssignments[request.ResourceID]` — it demands a specific owned
   assignment UUID. A list has no such UUID, so it fails closed. This needs a
   new branch permitting `ResourceID == ScopeID` for the collection case,
   following the documented `attempts` convention.

3. **SEB sessions need both.** There is no `sessions` case in
   `assignmentApplies` and no `/sessions/:id` policy row — only
   `/validation_events/:id` write. A candidate-facing session list needs a new
   `assignmentApplies` branch and a new policy migration.

Staff-facing (Class B) endpoints need no authorization changes: `college_admin`
and `department_user` hold `/*` with `*`, `mentor` holds `/*` with `read`, and
every resource name used below is already declared in the `routes` registry
(lines 129-164).

## Endpoint inventory

Class A = owner-scoped, `SECURITY DEFINER` + `current_context_actor_id()`.
Class B = tenant-scoped, plain `SELECT` under RLS.

### submission

| Endpoint | Class | Sort key | Filters |
|---|---|---|---|
| `GET /v1/tenants/{tenant_id}/attempts` | A | `created_at DESC, id DESC` | `exam_version_id`, `lifecycle_state` |
| `GET /v1/tenants/{tenant_id}/attempts/{attempt_id}/answers` | A | `created_at DESC, id DESC` | `exam_item_id` |

Index `attempts_candidate_idx (tenant_id, candidate_id, created_at DESC)` already
exists (`000002_domain.up.sql:35`). It lacks `id` as a trailing tiebreaker, so
the keyset comparison needs a sort for `created_at` ties. Add `id DESC` to the
index in the same migration.

### assessment

| Endpoint | Class | Sort key | Filters |
|---|---|---|---|
| `GET /v1/tenants/{tenant_id}/candidate-assignments` | A | `available_from DESC, id DESC` | `lifecycle_state` |
| `GET /v1/tenants/{tenant_id}/exams` | B | `created_at DESC, id DESC` | `lifecycle_state` |
| `GET /v1/tenants/{tenant_id}/exams/{exam_id}/versions` | B | `version_number DESC, id DESC` | `status` |

Index `candidate_assignments_candidate_idx (tenant_id, candidate_id,
available_from, available_until)` exists (`000002_domain.up.sql:173`); extend
with `id` for the keyset tiebreak.

### user

| Endpoint | Class | Sort key | Filters |
|---|---|---|---|
| `GET /v1/tenants/{tenant_id}/students` | B | `created_at DESC, id DESC` | `status`, `batch_id`, `department_id`, `enrollment_number_prefix` |
| `GET /v1/tenants/{tenant_id}/batches/{batch_id}/mentors` | B | `created_at DESC, id DESC` | — |
| `GET /v1/role-assignments` | B | `created_at DESC, id DESC` | `principal_id`, `role_name`, `scope_kind` |

`users.students` has no index on `(tenant_id, created_at, id)`; add one.

### tenant

| Endpoint | Class | Sort key | Filters |
|---|---|---|---|
| `GET /v1/tenants` | B (platform scope) | `created_at DESC, id DESC` | `status` |
| `GET /v1/tenants/{tenant_id}/departments` | B | `created_at DESC, id DESC` | `status` |
| `GET /v1/tenants/{tenant_id}/batches` | B | `created_at DESC, id DESC` | `department_id`, `status`, `academic_year` |
| `GET /v1/placement-organizations/{organization_id}/departments` | B | `created_at DESC, id DESC` | `status` |

`GET /v1/tenants` is a global resource per the `routes` registry
(`GlobalResources` includes `tenants`), so it must be called with an empty
tenant ID and is reachable only by `platform`-scope roles.

### question-bank

| Endpoint | Class | Sort key | Filters |
|---|---|---|---|
| `GET /v1/questions` (upgrade existing) | B | `published_at DESC, id DESC` | `difficulty`, `tag`, `language` |
| `GET /v1/questions/{question_id}/versions` | B | `version_number DESC, id DESC` | `status` |

Question-bank is the one service whose reads already go through `SECURITY
DEFINER` jsonb functions with `require_read_context`
(`000003_authoring_workflows_and_reliability.up.sql:798`). Both endpoints follow
that local idiom rather than the plain-`SELECT` idiom, so the service stays
internally consistent.

The existing `GET /v1/questions` keeps its `limit` parameter working unchanged;
`cursor` is additive.

### seb

| Endpoint | Class | Sort key | Filters |
|---|---|---|---|
| `GET /v1/tenants/{tenant_id}/sessions` | A | `issued_at DESC, id DESC` | `lifecycle_state` |
| `GET /v1/tenants/{tenant_id}/configurations` | B | `created_at DESC, id DESC` | `lifecycle_state` |

Total: 16 endpoints, 15 new and 1 upgraded.

## Cursor contract

New shared package `libs/pkg/pagination`, sitting alongside `httpx` and used by
all six services.

**Wire format.** `cursor` is base64url (unpadded) of
`<sort_value>|<uuid>`, where `sort_value` is RFC 3339 nanoseconds for
timestamps or a decimal integer for `version_number`. It is opaque to clients:
the encoding is an implementation detail and clients must treat it as a token.

It is deliberately **not** signed. A cursor conveys no authority — it is applied
strictly inside an already-authorized, tenant-scoped, actor-scoped query, so a
forged cursor can only reposition a caller within rows they may already read.
Signing it would imply the cursor is a capability, which would be misleading.

**Semantics.** Keyset, not offset:

```sql
WHERE (sort_col, id) < ($cursor_sort, $cursor_id)
ORDER BY sort_col DESC, id DESC
LIMIT $limit + 1
```

Fetching `limit + 1` rows detects whether more exist without a count query. The
extra row is dropped before serialisation and its predecessor's key becomes
`next_cursor`.

Offset pagination is rejected: rows are inserted continuously during an exam, so
offsets would skip and duplicate records mid-scroll.

**Parameters.** `limit` — integer, 1..100, default 20. `cursor` — optional
opaque token. An out-of-range limit or an undecodable cursor is
`400 invalid_argument`, never a silent clamp, matching the existing behaviour at
`services/question-bank/internal/adapters/http/handler.go:434`.

**Response envelope.** Extends the shape the one existing list route already
returns:

```json
{ "items": [ ... ], "next_cursor": "MjAyNi0wOC0yMFQxMDoxNTowMFo..." }
```

`next_cursor` is omitted when the page is the last one. `items` is always
present and is `[]`, never `null`, on an empty result.

**Package surface.**

```go
package pagination

type Cursor struct { SortValue string; ID string }

func Parse(raw string) (Cursor, bool, error)   // (cursor, present, error)
func Encode(sortValue, id string) string
func ParseLimit(raw string, def, max int) (int, error)
```

Nothing in the package touches SQL or HTTP; it is pure encoding plus validation,
so it is unit-testable without a database.

## Data flow

Unchanged from every existing read route, with one added step:

1. Handler parses `limit` and `cursor` via `libs/pkg/pagination`.
2. Handler calls `authorizer.AuthorizeHTTP` (Class B) or `AuthorizeSelfHTTP`
   (Class A) — a fresh central decision, no cache.
3. App service opens `database.WithTenantTx` with the signed capability, which
   validates the HMAC and sets the opaque RLS context.
4. Repo runs either a plain `SELECT` (Class B) or a `SECURITY DEFINER` list
   function (Class A) that filters on `authz.current_context_actor_id()`.
5. Handler serialises `{items, next_cursor}`.

No positive authorization decision survives the request, and the capability is
still single-transaction.

## Migrations

| Service | Migration | Contents |
|---|---|---|
| submission | `000016_attempt_list_functions` | `list_attempts`, `list_answer_revisions` (Class A); extend `attempts_candidate_idx` with `id` |
| assessment | `000016_candidate_assignment_list` | `list_candidate_assignments` (Class A); extend `candidate_assignments_candidate_idx` with `id` |
| seb | `000012_session_list_function` | `list_sessions` (Class A) |
| question-bank | `000009_question_list_functions` | replace `list_published_questions` with a cursor-aware version; add `list_question_versions` |
| user | `000020_student_list_index` | index on `users.students (tenant_id, created_at DESC, id DESC)` |
| user | `000021_seb_session_self_policy` | `('student','self','/sessions/:id','read')` |

Every migration ships a paired `.down.sql`. Every new function is `REVOKE ALL
... FROM PUBLIC` then `GRANT EXECUTE ... TO aether_<svc>_app`, matching
`000003_authoring_workflows_and_reliability.up.sql:862`.

Replacing `list_published_questions` changes a function signature. The down
migration restores the previous definition verbatim so
`make test-migrations` rollback-and-reapply stays green.

## Go changes

- `libs/pkg/pagination` — new package, plus README per the repo's
  document-every-module rule.
- `services/user/internal/app/authorization.go` — new `candidate_assignments`
  collection branch and new `sessions` branch in `assignmentApplies`, each with
  a comment explaining the actor-binding convention, matching the existing
  `attempts` comment.
- Per service: repo method, app method, handler, route registration, OpenAPI
  path.

## Error handling

| Condition | Response |
|---|---|
| `limit` non-integer or outside 1..100 | 400 `invalid_argument` |
| `cursor` not decodable / malformed parts / bad UUID | 400 `invalid_argument` |
| Unknown filter value (e.g. bad `lifecycle_state`) | 400 `invalid_argument` |
| Authorization denied | 403 `forbidden`, no distinction between "no rows" and "not permitted" |
| Actor context missing inside a Class A function | `RAISE EXCEPTION ... ERRCODE 42501`, surfaced as 403 |
| Empty result | 200 with `{"items": []}` |

A Class A function must never return an empty page when the actor GUC is
missing — it raises, matching
`services/seb/migrations/000006_self_session_validation.up.sql:71`. Failing
closed and loudly is the difference between "you have no attempts" and "the
security context did not load".

## Testing

**Unit — `libs/pkg/pagination`.** Table-driven: round-trip encode/decode,
rejection of malformed base64, wrong segment count, non-UUID id, limit bounds.

**Unit — handlers.** Following the existing `handler_test.go` pattern: limit and
cursor validation, envelope shape, `[]` not `null`, `next_cursor` present only
when a further page exists.

**Unit — `assignmentApplies`.** The highest-value tests in this change. For the
two new branches: a student listing their own collection is permitted; a student
presenting another principal's UUID is denied; a student with no matching scope
is denied; a revoked assignment is denied.

**SQL — Class A isolation.** A `*_test.sql` alongside each Class A migration,
following the existing `000011_rls_block_deletes_test.sql` convention: set a
context for candidate A, insert rows for candidates A and B, assert the list
function returns only A's rows, and assert it raises when no actor context is
set. This is the test that would catch the cross-candidate leak, so it is not
optional.

**Migration.** `make test-migrations` must pass fresh-apply, full rollback and
reapply, including the `list_published_questions` signature replacement.

Integration coverage against live Postgres remains blocked on sub-project F;
the SQL tests above run under the existing migration verifier in the meantime.

## Risks

| Risk | Mitigation |
|---|---|
| Cross-candidate leak via a Class B endpoint misclassified as staff-only | Class is recorded per endpoint in this spec; the `*_test.sql` isolation test is required for every Class A function |
| `assignmentApplies` change widens self scope more than intended | New branches permit only `ResourceID == ScopeID`; deny tests for foreign UUIDs |
| 16 endpoints × 3 network hops each amplifies the authz hot path | Out of scope here; this sub-project produces the read load that makes sub-project G measurable |
| Keyset sorts not index-backed on large tenants | Index changes are in-scope per the table above |

## Open question deferred to implementation

Whether `GET /v1/tenants` should page at all, given a realistic deployment has
tens of tenants rather than thousands. It is included for consistency; if
implementation shows the cursor machinery is disproportionate there, a plain
bounded list is acceptable and should be noted in the service README.
