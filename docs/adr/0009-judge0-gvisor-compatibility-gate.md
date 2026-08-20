# ADR-0009: Block Judge0 promotion until gVisor isolation is proven

- Status: accepted
- Date: 2026-07-24

## Context

Judge0 executes untrusted candidate programs. Its upstream sample compose
configuration is privileged and is therefore unsuitable for AetherCode. An
engine that needs privileged mode, host namespaces, a Docker socket, or public
egress cannot meet the platform's isolation boundary.

## Decision

The Judge0 CE 1.13.1 candidate is pinned by immutable digest and is not
production approved at foundation time. The `judge0-engine` Helm chart renders
nothing by default and refuses to render an enabled engine unless all of the
following are supplied:

- an approved compatibility-evidence reference and immutable tested image
  digest;
- RuntimeClass `gvisor`, non-root execution, no privilege escalation, no added
  capabilities, read-only root filesystems, and no host paths or namespaces;
- three server and three worker replicas scheduled across independent Judge
  nodes;
- deny-by-default network policy, no user-controlled networking, and disabled
  upstream callbacks; and
- engine-only credentials for its own opaque PostgreSQL and Redis deployment.

The compatibility gate must demonstrate the real language/test-suite profile,
network denial from a worker, queue replay after a node loss, and a final
verdict P95 of at most 60 seconds for the 10,000-candidate/five-minute burst.
If Judge0 CE cannot pass under these constraints, a reviewed hardened derivative
may be evaluated using the same CE application version and a newly recorded
digest. No security setting may be relaxed to obtain compatibility.

## Consequences

The current compatibility outcome is **not approved**: production engine
deployment is blocked until the evidence is recorded. Local development uses
only the wrapper control-plane compose profile and never starts an insecure
Judge0 engine. The upstream database remains isolated even after approval.
