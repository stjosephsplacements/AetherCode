# Helm Charts for Platform Services — Design Spec

Date: 2026-08-20
Sub-project: H
Status: active

## Problem

`deploy/helm/` has charts only for `judge-control` and `judge0-engine`. There
are no Deployment, Service, or ConfigMap manifests for the eleven platform
services (gateway, identity, tenant, user, question-bank, assessment,
submission, judge, seb, notification, analytics). The platform cannot be
deployed to Kubernetes.

## Approach: One generic chart + per-service values

A single `deploy/helm/platform-service/` chart parameterized by `values.yaml`
is correct for 11 near-identical microservices. The alternative (11 copies of
the same chart) is a maintenance burden and violates DRY. Each service gets a
`deploy/helm/platform-service/values-<svc>.yaml` that overrides only what
differs: image name, port, replica count, resource limits, env vars.

## Chart structure

```
deploy/helm/platform-service/
  Chart.yaml
  values.yaml             — defaults (overridden per-service)
  templates/
    deployment.yaml
    service.yaml
    serviceaccount.yaml
    configmap.yaml        — non-secret env vars
    hpa.yaml              — disabled by default; enabled per service
    pdb.yaml              — minAvailable: 1
    _helpers.tpl
  values-gateway.yaml
  values-identity.yaml
  values-tenant.yaml
  values-user.yaml
  values-question-bank.yaml
  values-assessment.yaml
  values-submission.yaml
  values-judge.yaml
  values-seb.yaml
  values-notification.yaml
  values-analytics.yaml
```

## Default values

```yaml
replicaCount: 2

image:
  repository: ""          # required: registry/image-name
  tag: ""                 # required: sha256 digest or semver
  pullPolicy: IfNotPresent

service:
  type: ClusterIP
  port: 8080

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 512Mi

env: []                   # list of {name, value} or {name, valueFrom}
envFrom: []               # list of secretRef or configMapRef

livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 15

readinessProbe:
  httpGet:
    path: /readyz
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 5

autoscaling:
  enabled: false
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70

podDisruptionBudget:
  enabled: true
  minAvailable: 1

serviceAccount:
  create: true
  annotations: {}

securityContext:
  runAsNonRoot: true
  runAsUser: 65532
  runAsGroup: 65532
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities:
    drop: [ALL]
```

## Gateway values (only public-edge service)

The gateway needs an Ingress (or LoadBalancer Service). All other services are
ClusterIP with no external exposure.

```yaml
# values-gateway.yaml
service:
  type: LoadBalancer
  port: 443

replicaCount: 3

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 20
```

## Secret management

Secrets (database passwords, HMAC keys, JWT signing keys) are NOT in the chart.
The chart expects a `Secret` named `<release>-secrets` to exist in the namespace.
Each service's `envFrom` entry references it:

```yaml
envFrom:
  - secretRef:
      name: "{{ .Release.Name }}-secrets"
```

The secrets are provisioned out-of-band (Sealed Secrets, Vault, or manual
`kubectl create secret`) before `helm install`. The chart itself never contains
a secret value.

## CI integration (Sub-project O)

Sub-project O will add a `helm lint` and `helm template` validation step to CI.
The charts are committed to the repo; the image tags are injected at deploy time
via `--set image.tag=sha256:...`.

## Definition of done

- `helm lint deploy/helm/platform-service/ -f deploy/helm/platform-service/values-gateway.yaml`
  exits 0 for all 11 values files.
- `helm template` produces valid Kubernetes manifests (validated with `kubectl --dry-run=client`).
- `deploy/helm/README.md` documents the deploy workflow: how to set image tags,
  how to create the secrets Secret, and how to do a rolling upgrade.
- `make lint` and `make build` still pass (no Go changes in this sub-project).
