# Judge0 gVisor compatibility gate

Judge0 CE is not production-approved merely because its chart exists. The
upstream v1.13.1 compose file requests privileged containers, so it is
reference-only and must not be copied into AetherCode.

The candidate starts from the verified upstream compatibility image
`judge0/judge0:1.13.1@sha256:6b5d6a66aa19a8e878a52ea3c6a560afc1086734d96e2885b561fd5c6018f082`.
If it cannot operate under the constraints below, build a reviewed hardened
derivative that preserves the Judge0 CE 1.13.1 application version, repeat the
gate, and record its new immutable digest. Do not relax any control to make the
candidate run.

Run the gate in an isolated staging cluster before production enablement:

```bash
bash deploy/validation/judge0-gvisor/check-chart.sh
NAMESPACE=aether-judge-engine \
  bash deploy/validation/judge0-gvisor/run-gate.sh
```

The release approver records a durable evidence reference containing all of the
following results before setting `compatibilityGate.approved=true` in the
`judge0-engine` chart:

1. Both server and worker Pods use RuntimeClass `gvisor`, are non-privileged,
   have no host namespace, host path, Docker socket, added capability, or
   writable root filesystem, and run from the immutable tested digest.
2. A code submission that opens a TCP socket to a controlled external endpoint
   terminates without network access; the accompanying worker-pod negative test
   in `run-gate.sh` also fails to connect outside the namespace.
3. Callbacks, custom compiler options, command-line arguments, additional files,
   batch submission, user-controlled networking, and synchronous result waits
   are rejected by the live Judge0 configuration.
4. The wrapper can submit, poll, normalize, and persist a full language/test
   matrix while the engine has only its own PostgreSQL and Redis credentials.
   The wrapper and engine databases are independently backed up and the wrapper
   never has direct engine-database access.
5. Three server and three worker Pods remain schedulable across three Judge
   nodes; drain one node and prove queued jobs are replayed without loss.
6. At the planned 10,000-candidate/five-minute burst profile, completion P95 is
   at most 60 seconds using the P90 real evaluation bundle. Preserve the load
   report and exact image/config digests with the evidence.

The engine chart itself refuses to render while `enabled` is false, approval is
false, evidence is absent, the runtime class is not `gvisor`, or fewer than
three server/worker replicas are requested.
