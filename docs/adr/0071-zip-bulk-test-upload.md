# ADR-0071: Zip bulk test upload in question intake

- Status: accepted
- Date: 2026-11-03

## Context

Staff writing questions often have dozens of test cases prepared as files on disk (one input file and one
expected-output file per test). Entering them one by one in the browser is tedious and error-prone, especially
for competitive-programming-style questions with large I/O.

## Decision

The question intake wizard accepts a `.zip` file containing paired test-case files. The naming convention is
`input_N.txt` / `output_N.txt` (or `in_N.txt` / `out_N.txt`), where N determines ordering. The zip is
decompressed client-side using `fflate` (already a frontend dependency), validated for structure and size limits,
and the extracted tests populate the same test-case list the manual entry uses. No server-side zip handling is
needed: the individual test cases are sent to the server as normal form submissions.

Size limits: 1 MiB per zip file, 256 KiB per individual test file, 100 test cases maximum per question. Files
exceeding these limits are rejected with a clear error before upload.

The walkthrough video (`apps/question-intake/public/walkthrough.mp4`) demonstrates the zip upload alongside
manual entry.

## Consequences

- Bulk import of test cases is fast: a 50-test question takes seconds instead of minutes.
- Client-side decompression avoids server-side zip-bomb risks entirely.
- The server never handles zip files, so the existing per-test validation and size enforcement apply unchanged.
- The naming convention is strict but documented; files that don't match are listed as skipped with a warning.
