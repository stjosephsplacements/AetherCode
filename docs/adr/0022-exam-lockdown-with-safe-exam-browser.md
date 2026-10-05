# ADR-0022: Exam lockdown with Safe Exam Browser

- Status: accepted
- Date: 2026-10-05

## Context

Milestone M4 needs exams that only run inside Safe Exam Browser (SEB):
students download a `.seb` file, SEB opens the exam, and the platform
refuses exam requests that do not come from that SEB.

The SEB service and Gateway already had a design for this, and it could not
work with a real browser:

- Gateway required custom headers (`X-AetherCode-SEB-Tenant-ID`,
  `X-AetherCode-SEB-Session-ID`) that SEB never sends.
- It compared the SEB headers with stored hashes of the raw keys. SEB sends
  `X-SafeExamBrowser-RequestHash = sha256(absolute URL + Browser Exam Key)`
  and `X-SafeExamBrowser-ConfigKeyHash = sha256(absolute URL + Config Key)`,
  a different value on every URL, so a fixed hash can never match. Checking
  them needs the keys themselves and the URL the browser requested.
- The lifecycle projection decoded `submission.attempt_submitted.v1` and
  `assessment.candidate_assignment.snapshot.v1` strictly into structs missing
  most of their fields, so it rejected every real event. Its database role
  also lacked `USAGE` on schema `seb`, so it could not have applied one anyway.

The exam app (ADR-0016) generates `.seb` files that SEB accepts
(`apps/exam-v1/lib/seb.ts`). It also has a per-URL check, `isSebRequest`, but
nothing calls it, and its download route reads a column no migration
creates. Its working half is the launch file; its check is the rule to
implement.

## Decision

1. **Staff lock an exam with the keys SEB reports.** SEB owns one policy per
   exam (`seb.exam_policies`): a title, an enabled flag, and up to 16
   accepted keys. A key is a Browser Exam Key or a Config Key as shown by the
   SEB Config Tool for that exam's launch file; several cover several SEB
   versions and platforms. Staff manage it with
   `PUT/GET /v1/tenants/{t}/exams/{e}/seb-policy` (the `configurations`
   capability).
2. **SEB knows which exams each candidate sits.** The lifecycle projection
   now decodes events leniently (producers add fields without a new
   version) and records every candidate assignment snapshot
   (`seb.candidate_assignments`: candidate, exam, window, state; an older
   snapshot never overwrites a newer one). New durables replay the stream so
   existing assignments are back-filled.
3. **Gateway checks every protected request, bound to the bearer.** Protected
   prefixes must be tenant-scoped. Gateway rebuilds the requested URL from
   `GATEWAY_SEB_PUBLIC_ORIGIN` and the raw request target, never from
   forwarded headers, and posts it with both SEB headers to SEB's
   `/v1/tenants/{t}/request-checks` as the bearer. A SECURITY DEFINER
   procedure finds the bearer's open assignments (window open, with a
   five-minute tail for deadline grace and time-up) to locked exams. With none,
   the answer is `not_required`. Otherwise the request passes only when a
   header equals sha256(URL + an accepted key). The keys never leave the
   database. The check needs only a self `read` on `sessions`, which
   students, mentors and staff all hold, so it never locks a read-only role
   out.
4. **Launch files are the exam app's.** `internal/domain/launchfile` ports
   the exam app's lockdown plist and encoding (gzip, RNCryptor format 2
   with the password, `pswd` prefix, gzip) and its download headers
   (`application/seb`, `Content-Encoding: identity`). SEB starts on
   `SEB_LAUNCH_BASE_URL/exam/<exam_id>` and quits on `/student`; the password
   (`SEB_LAUNCH_PASSWORD`) encrypts the file and is the quit password.
   Candidates download the file of an exam they are assigned to; staff
   download it to read the keys.

The single-server deployment protects `/api/submission/v1/tenants`, so
starting an attempt, saving answers, running code and submitting all require
SEB while a locked exam is open.

## Consequences

- A real SEB browser can sit a locked exam; nothing else can reach the
  candidate's Submission routes while that exam's window is open.
- The lock is per candidate, not per route: while a student has a locked
  exam open, their requests for any other exam need SEB too. Exams rarely
  overlap for one student.
- Staff must open the launch file in the SEB Config Tool once per SEB
  version they allow and paste the reported keys. The keys change whenever
  the launch settings (start URL, password) change.
- The Browser Exam Keys and Config Keys are stored in plaintext. They gate
  the browser, not data, and anyone holding the `.seb` file and SEB can
  compute them, so encrypting them would protect nothing.
- Each protected request costs one more Gateway→SEB call and authorization
  decision. M8's load test measures it.
- The request check writes no audit row (it runs on every request). The
  older configuration, session and header-validation API remains for quit
  tokens and is no longer on Gateway's path.
