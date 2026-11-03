# ADR-0069: A separate question intake app

- Status: accepted
- Date: 2026-11-03

## Context

Writing questions should not wait on platform development: the question bank's schema, the judge contract and
the roles model are all moving.

## Decision

`apps/question-intake` is a small Next.js app with its own Postgres database. Staff sign in through the
platform's identity service (staff roles only), write questions with tests and model solutions, and the hosted
execution engine must pass every model solution on every test before a question is saved. Saving needs a signed,
time-limited verification token bound to the exact content and the person. The platform's question bank and
database are not touched, and the two share no code or tables (as with the exam app, ADR-0016).

## Consequences

- Authors can work now; questions are imported into the platform bank later by a script that reads this database.
- The engine is called directly, so the intake app depends on the engine's HTTP API (`/api/v1/execute` and the
  `stream_token` stream) and not on the platform's judge service, which is private.
