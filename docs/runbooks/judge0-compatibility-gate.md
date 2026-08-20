# Judge0 gVisor compatibility gate

Judge0 is blocked from production until this gate has a durable approval
record. The local compose profile is deliberately wrapper-only; do not add the
privileged upstream sample compose services to it.

## Preconditions

- An isolated India-resident staging cluster has the `gvisor` RuntimeClass and
  three independent Judge nodes.
- The engine has its own opaque, India-resident HA PostgreSQL deployment and
  Redis deployment, separate from `aether_judge_wrapper` and the platform HA
  cluster. Restore evidence and the upstream CE 1.13.1 migration/seeding record
  are captured in `engineDatabase.haEvidenceRef`.
- The candidate is Judge0 CE 1.13.1 at the exact reviewed digest. A hardened
  derivative is allowed only after review and must preserve that application
  version while recording its own digest.
- The chart values provide six replicas total (three server, three worker),
  deny-by-default policy, engine-only secrets, and no host-level privileges.

## Execute

Run the static check before rendering the engine chart:

```bash
bash deploy/validation/judge0-gvisor/check-chart.sh
```

Deploy only an explicit gated release, then verify the live Pods and public
egress denial:

```bash
NAMESPACE=aether-judge-engine \
  bash deploy/validation/judge0-gvisor/run-gate.sh
```

Use the full procedure in
[`deploy/validation/judge0-gvisor/README.md`](../../deploy/validation/judge0-gvisor/README.md)
to record the language matrix, restricted-option rejection, full wrapper flow,
load test, and node-drain replay.

## Pass criteria

The evidence record must bind the exact chart revision, image digests, runtime
configuration, test dates, and approver to proof of all of the following:

1. server and worker run under gVisor without privilege, host paths,
   host namespaces, Docker socket, added capabilities, or writable root;
2. untrusted execution cannot reach the public network and cannot enable
   callbacks or controlled network access;
3. the wrapper submits, reconciles, and completes real evaluation bundles
   without direct access to the engine database;
4. a Judge node loss replays queued work without loss; and
5. the 10,000-candidate/five-minute profile reaches final-verdict P95 <= 60
   seconds.

If any check fails, leave `enabled: false` and
`compatibilityGate.approved: false`. Record the failure and remediation; do not
weaken gVisor, network policy, or container privileges as a workaround.
