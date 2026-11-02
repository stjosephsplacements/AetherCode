# ADR-0063: Function-only questions

- Status: accepted
- Date: 2026-11-02

## Context

Every question was a whole program: students wrote the includes, the input reading and the printing
as well as the logic. Practice sites show a stub and ask only for the function.

## Decision

- A question version may carry, per language, a stub (what the student starts from), a hidden prefix and a
  hidden suffix. The prefix and suffix hold the includes, the input reading, the call and the printing.
- They live in object storage next to the version's other artefacts (`qbank/templates/<version>.json`), so
  no migration is needed. They are editable only while the version is a draft; a published version is immutable.
- Practice shows the stub (`starters` on the practice question; the wrapper is never sent to students) and
  runs `prefix + student code + suffix` on run and submit. The model check composes the same way, so a
  model solution is the function alone. The student's stored code stays their own function, so history
  reopens as they wrote it.
- A language without a wrapper stays a whole-program question. A problem with stubs offers only the
  languages that have one.
- Staff edit stubs and wrappers in the question page (Function stubs).

## First pass and next

Practice, authoring and the model check are covered. Exams (the submission service composing the
code before grading) follow: until then, a function-only question should not be put in an exam.
