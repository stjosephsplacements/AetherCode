# ADR-0032: Question export and import

- Status: accepted
- Date: 2026-10-20

## Context

Colleges share questions. The exam app exports a question with its tests as a
file and imports it elsewhere. The platform builds encrypted test bundles on
the server and deliberately offers no way to download hidden tests
(`smoke.py` checks the old bundle download is gone): a hidden test seen by a
student is a solved question.

## Decision

**Only administrators export, and every export is recorded.**
`GET /v1/question-versions/{id}/export` (Question Bank) authorizes write on a
new resource, `question_exports`. The User service's policy lets a staff
assignment apply to it only for `college_admin`; platform administrators keep
their platform scope; department staff, mentors and students cannot obtain
it. `qbank.export_question_version` (migration `000015`) writes a
`question_export_events` row (who, which version, when) and returns the
version's content with the storage references of its evaluation and sample
bundles. Question Bank verifies, decrypts and parses both, marks which tests
are samples, and returns:

```json
{"format": "aethercode.question.v1", "title": "…", "prompt_markdown": "…",
 "difficulty": "easy", "supported_languages": ["python3"],
 "time_limit_ms": 2000, "memory_limit_kib": 262144,
 "tests": [{"input": "…", "expected_output": "…", "sample": true, "weight": 1}]}
```

**Import needs no new endpoint.** Any staff author uploads the file in the web
app; the server action creates a question and sets its tests through the
ordinary authoring endpoints, which validate it like a hand-written question.
It arrives as the importer's draft, to check and publish.

## Consequences

- The file holds hidden tests in plain text; it must be shared like an answer
  key. Exports can be audited from `qbank.question_export_events`.
- Server actions accept 2 MB, matching nginx; the gateway accepts 1 MiB of
  JSON, so a question whose tests exceed that cannot be imported in one file.
