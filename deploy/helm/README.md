# AetherCode Helm Charts

This directory contains Helm charts for deploying AetherCode platform services to Kubernetes.

## Charts

| Chart | Description |
|---|---|
| `platform-service/` | Generic chart for all 11 platform microservices |
| `platform-postgres-ha/` | PostgreSQL HA cluster |

---

## platform-service

A single parameterized chart deploys any of the 11 AetherCode microservices. Per-service
overrides live in `values-<svc>.yaml` files alongside the chart.

### Prerequisites

1. A Kubernetes cluster (1.25+) with `policy/v1` PodDisruptionBudget support.
2. The `<release>-secrets` Kubernetes Secret must exist in the target namespace **before**
   running `helm install`. The chart never contains secret values.

### Step 1 — Create the secrets Secret

Each service reads its configuration from a Secret named `<release-name>-secrets`. Create
it with `kubectl` before deploying:

```bash
kubectl create secret generic identity-secrets \
  --namespace aethercode \
  --from-literal=DB_DSN="postgres://identity:changeme@postgres-rw:5432/identity?sslmode=require" \
  --from-literal=JWT_HMAC_SECRET="<32-byte-hex>" \
  --from-literal=IDENTITY_INTROSPECTION_ADDR="127.0.0.1:9444"
```

Repeat for each service, substituting the correct secret keys. In production use
Sealed Secrets or Vault instead of plain `kubectl create secret`.

### Step 2 — Install a service

```bash
helm install identity deploy/helm/platform-service/ \
  --namespace aethercode \
  --create-namespace \
  -f deploy/helm/platform-service/values-identity.yaml \
  --set image.tag=sha256:abc123def456
```

The `image.tag` is injected at deploy time from the CI pipeline. Never bake a tag into
the values file; keep `tag: ""` in the committed file.

### Step 3 — Upgrade (rolling update)

```bash
helm upgrade identity deploy/helm/platform-service/ \
  --namespace aethercode \
  -f deploy/helm/platform-service/values-identity.yaml \
  --set image.tag=sha256:newdigest
```

Helm performs a rolling update. The PodDisruptionBudget (`minAvailable: 1`) ensures at
least one pod remains available during the rollout.

### Step 4 — Roll back

If a deployment is unhealthy, roll back to the previous revision:

```bash
helm rollback identity --namespace aethercode
```

To roll back to a specific revision:

```bash
helm history identity --namespace aethercode
helm rollback identity <revision> --namespace aethercode
```

### Deploying all 11 services

```bash
for svc in gateway identity tenant user question-bank assessment submission judge seb notification analytics; do
  helm upgrade --install "$svc" deploy/helm/platform-service/ \
    --namespace aethercode \
    --create-namespace \
    -f "deploy/helm/platform-service/values-${svc}.yaml" \
    --set image.tag="${IMAGE_TAG}"
done
```

### Linting the charts

```bash
# Lint generic chart only
helm lint deploy/helm/platform-service/

# Lint with per-service overrides
for svc in gateway identity tenant user question-bank assessment submission judge seb notification analytics; do
  helm lint deploy/helm/platform-service/ \
    -f "deploy/helm/platform-service/values-${svc}.yaml"
done
```

### Security notes

- All containers run as UID/GID 65532 (non-root), with a read-only root filesystem and
  `allowPrivilegeEscalation: false`.
- Secrets are never committed to the chart. They must be provisioned out-of-band.
- `gateway` is the only service with `service.type: LoadBalancer`. All other services
  use `ClusterIP` and are not externally reachable.
