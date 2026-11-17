# ADR-0081: Placement and integrity, Milestone A

- Status: accepted (decisions below confirmed by the owner 2026-11-17)
- Date: 2026-11-17

## Context

The platform runs exams end to end. The next scope adds placement tooling,
richer proctoring, a practice arena, more execution domains and department
analytics. This ADR splits that scope into three milestones and fixes the data
models, contracts and service boundaries for the first one. Milestones B and C
each get their own ADR before work starts.

| Milestone | Contents |
| --- | --- |
| A: placement and integrity | talent cards and public verification, company packs, live proctor grid, keystroke cadence detection |
| B: practice and tutor | practice arena, SQLite runner, post-release Socratic explainer, keystroke playback |
| C: analytics and consortium | concept heatmaps, AST similarity visualizer, multi-college drives and leaderboards |

Audio level, multi-monitor detection and keystroke playback share the client
capture channel with cadence detection. Only cadence is in A, as scoped; the
others reuse the same event path later.

## Decision

### What A reuses instead of building

- **Company packs need no new service or table.** `qbank.tags` is global and
  free-form. A company is a tag named `company:<slug>` (`company:tcs`). Authors
  filter the bank by tag when composing an exam. A drive-restricted slot is an
  exam whose assignment rule targets the drive's batch or department and whose
  window is the slot; both exist. A first-class drive entity waits for
  Milestone C, where the consortium needs one across colleges.
- **The live grid needs no new transport.** The exam monitor already refreshes
  live. The grid adds data to that read, not a channel.
- **No new protobuf contract.** Services here talk over HTTP and JetStream
  events; A adds events and HTTP only. Proto changes start with Milestone C.

### 1. Talent cards

A card is a signed, expiring claim set. Verification needs no login.

- **Owner:** Analytics. It already holds the gold rollups the card summarizes.
  It issues a card on demand; nothing is precomputed.
- **Claims:** card id, issued and expiry time, issuing college and department
  names, the student's display name, exam-count and per-exam percentile
  against the cohort, test-case pass rate, per-language pass rate, and median
  time to first accepted solution. Each claim is computed from rollups and
  stamped with the rollup's `source_revision`.
- **Signing:** Ed25519 over the canonical JSON, the same algorithm as the
  platform's identity signer. A new key id in the existing keyring flow, with
  rotation by publishing a second key and retiring the first.
- **Token:** `v1.<base64url claims>.<base64url signature>`. The QR code is only
  that URL, drawn by the frontend; the backend renders no image.
- **Verification:** `GET /v1/verify/talent-cards/{token}`, unauthenticated,
  rate limited, served through the gateway. It checks the signature, expiry
  and the revocation table, and returns the claims. It never reads the student
  tables.
- **Consent and PII:** a card exists only after the student opts in, naming
  what to include (the name is optional). Issuing needs `VIEW_STUDENT_PII` held
  at the placement department. Each issue, verification and revocation is
  audited. A student or a placement director can revoke a card.
- **Tables (Analytics):** `analytics.talent_card_consents(student_id, tenant_id,
  include_name, granted_at, revoked_at)`; `analytics.talent_cards(id, tenant_id,
  student_id, issued_by, issued_at, expires_at, claims_sha256, revoked_at)`.
  Both under forced RLS keyed on the tenant. The card body is not stored; it
  is rebuilt from rollups only to re-issue, and the signed token is the only
  copy a recruiter holds.
- **Events:** `analytics.talent_card.issued.v1` and `.revoked.v1`, for the
  audit feed.

### 2. Live proctor grid

- **Violation counts reach Submission by event.** The proctor service publishes
  `proctor.violation.recorded` (attempt, tenant, kind, confidence, time) to
  JetStream after it stores a violation. Submission projects it into
  `submission.attempt_violation_counts(attempt_id, tenant_id, kind, count,
  last_at)`. Submission keeps its own copy so the grid reads one database.
- **Severity** is computed server-side by one function from the counts and the
  attempt's policy limit: amber from half the limit or any `PROHIBITED_DEVICE`
  and red at the limit, and with no policy a fixed default of 5. The colour
  never comes from the client.
- **Read:** the existing exam monitor response gains per attempt `severity`,
  per-kind counts and the newest snapshot id. A bulk
  `GET /v1/tenants/{t}/exam-versions/{v}/proctor-grid` returns newest snapshot
  URLs for the visible attempts, up to 200 per page.
- **Permission:** thumbnails are student images, so the grid read is
  `read` on `proctor_evidence`, which ADR-0080 maps to `VIEW_STUDENT_PII`. Each
  grid read is audited once per request, not per tile.
- **Frontend:** a grid view in the monitor page, polling the grid read at the
  monitor's existing interval; thumbnails refresh only when the snapshot id
  changes.

### 3. Keystroke cadence detection

- **Client:** the editor hook measures inter-key intervals over a rolling
  window (mean, variance, longest burst) and the size of any single insertion.
  It sends only these numbers, never the text.
- **Server:** `record_integrity_event` accepts a new kind `cadence_anomaly`
  with a bounded numeric payload, under the existing per-attempt cap of 1000
  events. Thresholds are constants in the client and are not security
  controls: the client is untrusted.
- **Use:** advisory only. The signal appears in the monitor and the attempt
  detail. It never auto-submits or lowers a score. Counting it toward the
  ADR-0080 breach limit is a separate decision.

## Consequences and risks

- The talent card is only as good as the rollups. Per-language and per-test
  figures need the grading event to carry language and test counts. If
  Analytics' event facts lack them, A starts with a migration and event
  change in Submission and Analytics before any card can issue. This must be
  checked first.
- A signed card is valid until it expires or is revoked; a recruiter holding a
  stale copy sees old claims. Expiry is short (default 90 days) and shown in
  the verification response.
- The public endpoint is the platform's first unauthenticated read; it needs
  its own rate limit and a gateway allow-list entry, and an abuse review.
- Cadence signals produce false positives (paste from notes, assistive input).
  Advisory status is the mitigation; a human decides.
- The proctor to Submission event adds a second consumer and a projection to
  keep healthy; it joins readiness as ADR-0080's consumer did.

## Decisions (confirmed)

1. **Analytics owns card issuance.**
2. **Card contents.** A recruiter with the token sees the student's name,
   college and department, cohort percentile (top X%), language proficiencies,
   problem accuracy and a code speed index. A drive that requires blind
   evaluation can hide the name and the college and department. Roll number,
   email and phone are never shown unless the student ticks
   `share_contact_info` at consent time.
3. **Dedicated signing key.** `TALENT_CARD_SIGNING_KEY` (Ed25519), separate
   from the identity keyring, so a card key leak cannot sign sessions and
   session revocation does not invalidate cards.
4. **Cadence is advisory only.** It flags an attempt for staff review. It never
   auto-submits and never counts toward the ADR-0080 breach limit.

The consent table therefore also holds `share_contact_info` and
`blind_evaluation` choices, and the claims omit contact data when the former is
false.
