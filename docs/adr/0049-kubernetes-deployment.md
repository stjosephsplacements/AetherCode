# ADR-0049: Kubernetes deployment

- Status: accepted
- Date: 2026-10-22

## Context

Only `platform-service` existed for Kubernetes, and it could not run the
platform: it had no frontend, no mTLS certificates, no backing services, no
migrations or capability keys, and its defaults did not match the services'
real configuration.

## Decision

**Five charts, one install order.** `platform-pki`, `platform-infra`,
`platform-migrations`, then `platform-service` once per workload (the eleven
services and the frontend). One generic service chart with a values file per
service keeps twelve deployments consistent; a chart per service would repeat
the same templates twelve times.

**Migrations are Helm hooks.** `pre-install` and `pre-upgrade` Jobs run the same
tools image and scripts as the single-server stack, so a failed migration stops
the rollout before any pod changes.

**mTLS comes from cert-manager.** A self-signed root issues a CA, and each service
gets an ECDSA P-256 certificate with its DNS names and the same SPIFFE URI SAN
the Compose stack uses, so service code is unchanged.

**Secrets are created out of band.** `generate-secrets.sh` prints one Secret
manifest and never writes to disk. `kubectl create` refuses to overwrite it.
Charts reference keys only; the service chart requires `global.secretName`.

**Default-deny, then allow lists.** `platform-infra` denies ingress in the
namespace. Each chart opens its callers, mirroring the Compose network
topology.

**Backing services stay single-instance by default.** They match the campus
deployment and the tested configuration. High availability is an opt-out of the
block plus the existing `platform-postgres-ha` chart, not a different default.

## Consequences

- A cluster needs cert-manager, a NetworkPolicy-enforcing CNI and an ingress controller.
- Three scripts are copied into the charts (Helm cannot read outside a chart). `make k8s-lint` fails if a copy drifts from its original.
- The code engine remains outside the cluster (ADR-0028).
- CloudNativePG client-certificate authentication is not wired into the service charts; follow-up when a high-availability database is required.
