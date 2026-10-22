# AetherCode on Kubernetes

Helm charts that run the whole platform in one namespace. They mirror the
single-server Compose stack (`deploy/single-server`), so a service behaves the
same in both. Decision record: [ADR-0049](../../docs/adr/0049-kubernetes-deployment.md).

| Chart | Installs |
|---|---|
| `platform-pki` | cert-manager issuers and one mTLS certificate per service (SPIFFE URI SAN) |
| `platform-infra` | PostgreSQL, the judge database, NATS JetStream (3 nodes), MinIO, RabbitMQ, a backup CronJob and the namespace default-deny NetworkPolicy |
| `platform-migrations` | Hook Jobs: platform migrations and capability keys, judge migrations, judge language mappings |
| `platform-service` | One chart for all eleven Go services and the frontend, configured by `values-<service>.yaml` |
| `platform-postgres-ha` | Optional CloudNativePG cluster in place of the single PostgreSQL pod |

## Prerequisites

- Kubernetes 1.27 or newer, a default StorageClass, and a CNI that enforces NetworkPolicy (Calico, Cilium). Without one the policies are accepted but not enforced.
- [cert-manager](https://cert-manager.io) installed in the cluster.
- An ingress controller (the default values assume ingress-nginx) and a TLS Secret for your host.
- Helm 3.14 or newer, `kubectl`, `openssl`.
- Container images built by CI: `ghcr.io/stjosephsplacements/aethercode-<service>`, `aethercode-frontend` and `aethercode-tools`. Tags are the commit SHA and `latest`, pushed from the `production` branch; use the SHA for installs.
- The code engine. It runs outside the cluster (ADR-0028); set `global.engineUrl` to where the judge pods reach it.

## Install

```bash
kubectl create namespace aethercode
./generate-secrets.sh aethercode | kubectl create -f -
./install.sh aethercode https://exam.example.edu exam.example.edu 0.2.0 \
  --set ingress.className=nginx --set ingress.tlsSecretName=exam-tls
```

Keep a copy of the Secret in your password manager or sealed-secrets store. It
holds the identity signing key and the per-database capability keys; losing it
means every session is invalidated and the capability keys must be re-issued.

`install.sh` runs, in order: `platform-pki`, `platform-infra`, `platform-migrations`,
then each service. Each step waits for readiness. Migrations run as Helm
pre-install and pre-upgrade hooks, so a failed migration stops a rollout before
any pod changes.

Create the first administrator with the `bootstrap` command in the tools image, run as a one-off pod with the same Secret variables the migration Job uses. Its flags are documented in `deploy/single-server/README.md`.

## Secrets

`generate-secrets.sh` writes these keys; nothing else holds a secret. Database
passwords never appear in a ConfigMap. Services read connection strings built
from `$(…_DB_PASSWORD)` references at start.

| Keys | Used by |
|---|---|
| `POSTGRES_SUPERUSER_PASSWORD`, `*_DB_PASSWORD` | infra, migrations, services |
| `JUDGE_RABBITMQ_PASSWORD`, `MINIO_ROOT_*` | infra, judge, storage clients |
| `IDENTITY_*` | identity token signing, assertion verification, MFA, delivery tokens |
| `AUTHZ_CAPABILITY_KEYS` | migrations (installs keys), user and identity |
| `PLATFORM_KMS_LOCAL_KEY`, `SEB_LAUNCH_PASSWORD` | services that encrypt objects, SEB launch files |
| `JUDGE0_AUTH_TOKEN`, `IDENTITY_SSO_CLIENT_SECRET` | optional; add to the Secret only when you use Judge0 or single sign-on |

## Upgrade and roll back

```bash
./install.sh aethercode https://exam.example.edu exam.example.edu 0.3.0 --set ingress.className=nginx
helm -n aethercode history gateway
helm -n aethercode rollback gateway <revision>
```

Migrations only move forward. Roll the services back first, and restore a
database backup only if a migration itself was wrong.

## Security model

- Every pod runs as a non-root user with a read-only root filesystem, all capabilities dropped, the default seccomp profile and no service-account token.
- `platform-infra` denies all ingress in the namespace. Each service chart opens only the callers listed in its `networkPolicy.allowFrom`, and the frontend accepts traffic only from the ingress namespace.
- Service-to-service calls use mTLS with certificates from `platform-pki`; trust is the SPIFFE URI SAN, not the network.
- The gateway trusts `X-Forwarded-For` only from `gatewayTrustedProxyCIDRs`. Narrow the default private ranges to your pod CIDR.

## Limits to know before production

- `platform-infra` runs single-instance PostgreSQL, MinIO and RabbitMQ on one volume each. NATS is the only clustered piece. For high availability use `platform-postgres-ha`, a managed object store and a managed broker, disable the matching block in `platform-infra/values.yaml`, and point `global.*` at them. The CloudNativePG client-certificate mode is not wired into the service charts yet.
- Backups are `pg_dumpall` files on a PVC in the same cluster. Copy them off-cluster.
- The engine is external; the cluster does not isolate untrusted code itself.
- NetworkPolicy needs a CNI that enforces it; verify with a denied connection before an exam.

## Checks

```bash
make k8s-lint
```

lints every chart, renders all twelve workloads and verifies that the scripts copied into the charts match their originals.
