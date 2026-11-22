# ADR-0078: Exam proctoring foundation

- Status: accepted
- Date: 2026-11-08

## Context

The platform already records three integrity signals during a live exam:
- `blur` — student left the exam window or the page became hidden
- `fullscreen_exit` — student exited fullscreen while the exam requires it
- `paste` — student tried to paste text from outside the exam (blocked)

These are stored via `POST /v1/tenants/:t/attempts/:a/events` and visible to
the invigilator on the live monitor as a per-student flag count. The
submission service counts them with `submission.record_integrity_event` and
the exam screen enforces them via `useIntegrity` (ADR-0037).

The roadmap calls for "webcam snapshots, hybrid face and phone detection,
screen/tab events, live proctor view, consent screen, per-exam violation
policy, evidence in MinIO gated by `VIEW_STUDENT_PII`". This is a phased
feature; the first phase is client-side only.

## Decision

### Phase 1 (this ADR) — client-side foundation (no backend schema change)

**`useWebcam` hook** (`frontend/src/components/exam/use-webcam.ts`) manages a
`getUserMedia` stream during an active exam. It:
- requests camera access when the exam screen activates
- captures a 320×240 JPEG snapshot every 60 seconds into an in-memory ring buffer (last 10)
- detects access denied vs hardware unavailable

Snapshots are held in browser memory only and discarded on page close. No
server upload yet.

**Consent screen** is implicitly handled by the browser's native permission
dialog. No additional consent UI is needed; if the student denies, the
`state.kind === "denied"` branch is surfaced to the invigilator as a flag.

**When to activate**: the `require_fullscreen` field on the live state is
already per-exam-version. Phase 2 will add a `webcam_required` field to the
submission service's `exam_integrity` table, exposed on `AttemptLiveState`.
Until then, webcam is off by default.

### Phase 2 — server-side evidence (future, needs schema approval)

1. Add `webcam_required boolean DEFAULT false` to `submission.exam_integrity`.
2. Expose `webcam_required` on `AttemptLiveState`.
3. Add `POST /v1/tenants/:t/attempts/:a/snapshots` endpoint that accepts a
   base64 JPEG, stores it in MinIO under
   `tenants/{t}/attempts/{a}/snapshots/{ts}.jpg`, gated by
   `VIEW_STUDENT_PII`.
4. Wire `useWebcam` to call this endpoint and replace the in-memory ring buffer
   with server-confirmed storage.
5. Add snapshot gallery to the attempt detail page for invigilators.

### Phase 3 — client TF.js hints (shipped MVP)

BlazeFace in the browser runs beside the GPU proctor path. Hints post to
`POST .../client-proctor-hints` as **advisory** rows only; they do not feed
violation counts or auto-submit (ADR-0080). Staff read them with proctor
evidence; snapshots remain `VIEW_STUDENT_PII`. Phone detection on the client
is deferred; the server YOLO path stays authoritative.

## Consequences

- Phase 1 ships the hook and keeps the door open for Phase 2 with no breaking
  changes.
- Phase 2 requires a schema migration approval; it does not change existing
  integrity event recording.
- Phase 3 is entirely additive.
- Browser permission dialog is the consent surface for Phase 1 and 2; a
  formal in-page consent step before exam start may be added if the college
  requires it.
