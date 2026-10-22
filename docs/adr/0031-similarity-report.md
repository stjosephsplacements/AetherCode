# ADR-0031: Code similarity report

- Status: accepted
- Date: 2026-10-19

## Context

Faculty need to spot copied code after an exam. The exam app has a
similarity report: MOSS-style winnowing over each student's final code per
question, ignoring code most of the class wrote.

## Decision

`GET /v1/tenants/{t}/exam-versions/{v}/similarity` (Submission) authorizes read
on `judge_receipts` for the exam version, the reviewer resource no candidate
can hold. `submission.list_exam_latest_answers` (migration `000030`) returns
every attempt's latest saved answer per question as storage references;
Submission reads and decrypts them, at most 16 at a time, and compares them
question by question with `internal/domain/similarity`, a port of the exam
app's algorithm:

- tokens ignore names, literals, comments and layout;
- 8-token grams are hashed (FNV-1a) and winnowed with a window of 4;
- fingerprints held by more than half the programs (at least 2, at most 50)
  are ignored;
- a pair's score is its shared fingerprints over the smaller program's
  distinctive ones; programs with fewer than 6 are not judged;
- pairs scoring at least 0.6 are reported, at most 100 per question, most
  similar first.

The staff results page links to the report, and each student in a pair links
to their attempt review (ADR-0029).

## Consequences

- The report is computed on request. A 1000-student exam reads and decrypts
  one object per student per question; it takes seconds, not minutes.
- "Final code" is the latest save, which is what time-up and End test grade.
  The exam app used the latest submit and fell back to the draft.
- A high score is a reason to look at both programs, not proof of copying.
