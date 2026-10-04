# Assessment migrations

Apply paired migrations with `aether_assessment_migrator`:

```sh
make migrate SVC=assessment DIR=up
```

`000008_authorization_projection_resync` adds the target-bound recovery
request, durable item ledger, and projection-ready RLS gate. The dedicated
`aether_assessment_projection_worker` is the only runtime role with the
narrow state/item and function privileges; an incomplete batch remains denied.

`000024_exam_item_execution_limits` pins the Question Bank's time limit, memory
limit and supported languages on each exam item next to its bundles and carries
them in every candidate assignment snapshot, so Submission can validate a
candidate's language and dispatch grading with the right limits. Legacy items
keep NULLs; rollback restores the previous snapshot builders and drops the
columns.
