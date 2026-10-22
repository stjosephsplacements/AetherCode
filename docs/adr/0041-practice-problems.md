# ADR-0041: Practice problems and the question audience

- Status: accepted
- Date: 2026-10-20

## Context

The old AetherCode had a practice section, and staff asked for a way to
mark each question as for tests or for practice, so that test questions
stay private. The question bank is global and only staff can read it:
its signed contexts carry no tenant and need a staff grant in the
global authorization projection.

## Decision

**Every question has an audience** (Question Bank migration `000018`),
either `test` (the default) or `practice`. Staff switch it on the question
page with `PUT /v1/questions/{id}/audience`. The exam page offers test
questions only, because practice questions are public to students.

**Students practise in Question Bank.** It already holds the encrypted
bundles and is a Judge client (ADR-0033), so practice adds no new service.
A student authorizes as themselves on a new resource,
`practice_submissions`, in their own tenant (User migration `000028`: a
`student`/`self` rule; the user service requires a tenant for this one
resource of the global route). The decision sets a capability in Question
Bank's `authz.set_context`. That function now accepts a tenant only for
`qbank.practice_submissions`. It checks the signature as before; it skips
the global projection check, which applies to staff. Every staff function
and RLS policy still requires a tenant-less context, so a practice context
reaches nothing else. Every practice function binds rows to the signed
actor.

Students can:

- list practice problems, with their own solved and attempted state;
- read a problem with its decrypted sample tests;
- run code on the samples, or on their own input (a one-off sample
  bundle, as in exams);
- submit code on every test, hidden ones included;
- see their last 20 runs and the code of each;
- see their totals and active days.

Hidden tests show a verdict only, never input or output.

**Judge capacity.** Practice jobs use the fairness key
`question-bank:practice`. Each student may have one job in flight, and
there are at most 12 across the platform. Judge has 32 workers, so exams
always keep most of them. A job Judge has not finished in 10 minutes
stops counting and is marked failed. The completion worker records each
completion on the model check or practice run it belongs to, and decrypts
a sample run's per-test output.

## Consequences

- Moving a question to practice exposes its statement and samples at once
  to every college. The switch asks for confirmation. Nothing stops staff
  from moving a question an upcoming exam already pins.
- Practice code and outputs are stored like exam runs: encrypted code in
  object storage, outputs in the database. Nothing cleans them up yet.
- Only coding questions are practised; multiple-choice questions stay
  test-only.
