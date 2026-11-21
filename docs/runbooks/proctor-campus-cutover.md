# Proctor campus cutover (ADR-0080 / ADR-0088)

Owner-run checklist after merging the staff policy UI and snapshot paging.

## 1. Migrate before the new submission binary

Submission migration `000050` replaces `list_snapshots` with a four-argument
signature. Deploy order:

1. Apply migrations (`helm upgrade migrations …` or the campus migrate job).
2. Then roll submission (and frontend / proctor as needed).

Rolling the binary first against the three-argument function fails every
snapshot list.

## 2. Redis for shared cooldown

`platform-infra` deploys Redis with pods labelled `app.kubernetes.io/name: redis`.
Confirm:

```bash
kubectl -n "$NAMESPACE" get deploy,svc,pods -l app.kubernetes.io/name=redis
kubectl -n "$NAMESPACE" exec deploy/proctor -- sh -c 'echo "$PROCTOR_REDIS_URL"'
```

Empty `PROCTOR_REDIS_URL` keeps the database cooldown (replicas can race).

## 3. Live NATS + GPU proof

1. Create a published policy with `enabled` and a short cooldown; attach it to a
   short exam; start an attempt with webcam consent.
2. Confirm MinIO receives snapshots and NATS `proctor.analyze` events.
3. Confirm violations appear on the attempt page and the proctor grid.
4. Force a breach with `max_violations` / `auto_submit_on_breach` on a throwaway
   attempt; confirm `proctor.violation.threshold` submits the attempt.

## 4. SEB + similarity (exam-v1 parity)

Still need a lab PC with real Safe Exam Browser:

1. Lock an exam with Browser Exam Key / Config Key; launch via `.seb` ticket.
2. Confirm gateway rejects non-SEB submission calls while the attempt is open.
3. Run two near-duplicate submissions and open `/staff/exams/{id}/similarity`.

Judge capacity for the slot: see `docs/runbooks/judge-capacity.md`.
