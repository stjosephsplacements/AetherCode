# AetherCode

AetherCode is a multi-tenant coding-assessment platform for colleges. This
repository delivers the v1 backend foundation and core workflows: service-owned
PostgreSQL schemas, identity and authorization, tenant/user management,
immutable question and assessment authoring, candidate attempts, event-fed
analytics, notifications, Gateway/SEB enforcement, and an isolated Judge
control-plane boundary. It is **not** a production-promotion declaration:
external integrations and operational evidence remain tracked in
[TASKLIST.md](TASKLIST.md). The Next.js frontend is intentionally out of scope
for this delivery.

## Repository layout

- `services/` contains independently deployable Go services.
- `libs/pkg/` contains shared, framework-neutral platform packages.
- `libs/proto/` is the source of truth for internal gRPC contracts.
- `deploy/` contains local, Kubernetes, and database provisioning assets.
- `docs/` contains architecture records, database documentation, and API output.

Start with [the implementation plan](PLAN.md), [the documentation index](docs/README.md),
and [the delivery status](TASKLIST.md).

## Security and database model

The User service is the canonical Casbin-backed authorization decision service.
Its private mTLS `authz/v1.Authorize` API issues a fresh, five-second,
database-audience-bound HMAC capability for each allowed request. A target
database validates that capability in `authz.set_context`, binds it to the
current PostgreSQL backend and transaction, and checks the local
authorization-revision projection under `FORCE ROW LEVEL SECURITY`. A failed
decision, expired capability, or projection lag denies access. The complete
contract is in [docs/database/authorization-context.md](docs/database/authorization-context.md).

Authorization recovery is fail closed as well. Each RLS-protected service
starts with its local authorization projection unavailable and, after an
outbox or authorization-consumer failure, writes a target-specific resync
request through its local outbox. The User service returns a manifest-verified
grant snapshot; the target reopens only after every item has been applied.
This prevents a stream-retention gap from silently retaining access after a
revocation.

Every stateful platform service owns one logical database in the three-node
platform PostgreSQL topology. Database owners are non-login roles; migrations,
applications, and authorization-projection workers use separate least-privilege
identities. Run migrations only as the service migrator after the role/database
provisioner has run. Authorization HMAC material is supplied by the approved
KMS/secret controller after bootstrap with
[`scripts/provision-authz-context-key`](scripts/provision-authz-context-key);
the script neither generates nor stores a secret.

The platform HA chart is deliberately render-gated on client certificates and
India-resident encrypted backup inputs. A successful render or install is not
HA acceptance: the node-failure and PITR exercises in
[the platform PostgreSQL runbook](deploy/runbooks/platform-postgres-ha.md) are
required before promotion.

## Judge boundary and release gate

Judge control-plane state is isolated in `aether_judge_wrapper` with its own
PostgreSQL HA deployment and RabbitMQ quorum cluster. It does not own or share
Redis with the platform; Redis is an internal dependency of the separately
operated Judge0 engine after approval. The wrapper accepts durable, encrypted
references and leases completions through private mTLS gRPC. Submission has a
completion-only bridge that persists a leased result before ACKing it and then
publishes the platform-owned completion event. That bridge cannot admit work to
the wrapper. The foundation does **not** include a Judge0 engine dispatcher, a
safe admission adapter, or a proven grading path.

The Judge0 engine chart is disabled by default. It must remain blocked until
the gVisor, no-network, non-privileged compatibility gate has approved an
immutable image and recorded queue-replay, node-failure, and 10,000-candidate /
five-minute load evidence, including the 60-second final-verdict P95 target.
See [the compatibility-gate runbook](docs/runbooks/judge0-compatibility-gate.md).

## Current backend scope

Implemented HTTP/gRPC backend workflows include identity registration, login,
MFA and recovery; college, department, batch, role, placement and student
affiliation management; immutable question/exam version publication and
assignments; candidate attempts and append-only answers; in-app notification
preferences; and event-fed progress/reporting projections. Gateway uses an
explicit private-upstream allow-list, verifies protected identity assertions on
every request, and calls SEB validation before configured exam routes are
forwarded.

The services deliberately persist encrypted object references rather than
pretending to provide an object-storage/KMS implementation. Likewise, email
delivery, analytics-export storage, a platform-side **admission** adapter, and
the Judge0 dispatcher require their separate approved external integrations.
They must not be replaced with local mock behavior in a production deployment.

## Local prerequisites

Install Go, Docker, GNU Make, Buf, and golangci-lint. The pinned
`golang-migrate` runner is built through Go, so no separately installed
migration CLI is needed. Copy `.env.example` to `.env` and replace development
passwords before running the local stack.

## Common commands

```sh
make dev-up
make dev-judge-up
make build
make test
make test-migrations
make lint
make migrate SVC=identity DIR=up
```

`make dev-up` starts the `platform` compose profile. `make dev-judge-up` starts
the isolated Judge control-plane profile using an untracked `.judge-control.env`
file; it intentionally does not start Judge0. `make test-integration` requires
Docker. Production credentials and database roles are provisioned through the
deployment configuration, never from this repository.
