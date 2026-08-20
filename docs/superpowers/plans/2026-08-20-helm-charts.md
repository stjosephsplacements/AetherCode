# Helm Charts for Platform Services — Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-08-20-helm-charts-design.md`

**Goal:** Create a generic Helm chart for all 11 platform services plus per-service values files. The chart must lint clean and produce valid K8s manifests.

## Global Constraints
- `helm lint` must pass for all 11 services
- `helm template` output must pass `kubectl apply --dry-run=client`
- No secret values in the chart — secrets come from a pre-existing K8s Secret
- All containers run as UID/GID 65532, non-root, read-only filesystem, no privilege escalation
- Health checks: liveness `/healthz`, readiness `/readyz` on the service's HTTP port
- Minimum 2 replicas with a PodDisruptionBudget of minAvailable:1
- `make build`, `make lint` still pass (no Go changes)

---

## Task 1: Generic chart scaffold

**Files:**
- Create: `deploy/helm/platform-service/Chart.yaml`
- Create: `deploy/helm/platform-service/values.yaml`
- Create: `deploy/helm/platform-service/templates/_helpers.tpl`
- Create: `deploy/helm/platform-service/templates/deployment.yaml`
- Create: `deploy/helm/platform-service/templates/service.yaml`
- Create: `deploy/helm/platform-service/templates/serviceaccount.yaml`
- Create: `deploy/helm/platform-service/templates/pdb.yaml`
- Create: `deploy/helm/platform-service/templates/hpa.yaml`
- Create: `deploy/helm/platform-service/templates/configmap.yaml`

### Step 1: Chart.yaml

```yaml
apiVersion: v2
name: platform-service
description: Generic chart for AetherCode platform microservices
type: application
version: 0.1.0
appVersion: "0.1.0"
```

### Step 2: values.yaml (defaults)

```yaml
replicaCount: 2

image:
  repository: ""
  tag: ""
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

env: []
envFrom: []

livenessProbe:
  httpGet:
    path: /healthz
    port: http
  initialDelaySeconds: 10
  periodSeconds: 15
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /readyz
    port: http
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 3

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
  name: ""

podAnnotations: {}
podLabels: {}

podSecurityContext:
  runAsNonRoot: true
  runAsUser: 65532
  runAsGroup: 65532
  fsGroup: 65532

containerSecurityContext:
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities:
    drop: [ALL]

nodeSelector: {}
tolerations: []
affinity: {}
```

### Step 3: _helpers.tpl

```
{{/*
Expand the name of the chart.
*/}}
{{- define "platform-service.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "platform-service.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "platform-service.labels" -}}
helm.sh/chart: {{ include "platform-service.chart" . }}
{{ include "platform-service.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "platform-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "platform-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Chart label
*/}}
{{- define "platform-service.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
ServiceAccount name
*/}}
{{- define "platform-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "platform-service.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
```

### Step 4: templates/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "platform-service.fullname" . }}
  labels:
    {{- include "platform-service.labels" . | nindent 4 }}
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "platform-service.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      annotations:
        {{- with .Values.podAnnotations }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
      labels:
        {{- include "platform-service.labels" . | nindent 8 }}
        {{- with .Values.podLabels }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
    spec:
      serviceAccountName: {{ include "platform-service.serviceAccountName" . }}
      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}
      containers:
        - name: {{ .Chart.Name }}
          securityContext:
            {{- toYaml .Values.containerSecurityContext | nindent 12 }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: {{ .Values.service.port }}
              protocol: TCP
          livenessProbe:
            {{- toYaml .Values.livenessProbe | nindent 12 }}
          readinessProbe:
            {{- toYaml .Values.readinessProbe | nindent 12 }}
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
          {{- with .Values.env }}
          env:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with .Values.envFrom }}
          envFrom:
            {{- toYaml . | nindent 12 }}
          {{- end }}
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
```

### Step 5: templates/service.yaml

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ include "platform-service.fullname" . }}
  labels:
    {{- include "platform-service.labels" . | nindent 4 }}
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: http
      protocol: TCP
      name: http
  selector:
    {{- include "platform-service.selectorLabels" . | nindent 4 }}
```

### Step 6: templates/serviceaccount.yaml

```yaml
{{- if .Values.serviceAccount.create -}}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "platform-service.serviceAccountName" . }}
  labels:
    {{- include "platform-service.labels" . | nindent 4 }}
  {{- with .Values.serviceAccount.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
{{- end }}
```

### Step 7: templates/pdb.yaml

```yaml
{{- if .Values.podDisruptionBudget.enabled -}}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "platform-service.fullname" . }}
  labels:
    {{- include "platform-service.labels" . | nindent 4 }}
spec:
  minAvailable: {{ .Values.podDisruptionBudget.minAvailable }}
  selector:
    matchLabels:
      {{- include "platform-service.selectorLabels" . | nindent 6 }}
{{- end }}
```

### Step 8: templates/hpa.yaml

```yaml
{{- if .Values.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "platform-service.fullname" . }}
  labels:
    {{- include "platform-service.labels" . | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "platform-service.fullname" . }}
  minReplicas: {{ .Values.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.autoscaling.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}
{{- end }}
```

### Step 9: Lint the chart

```bash
helm lint deploy/helm/platform-service/
```

Expected: no errors.

### Step 10: Commit the generic chart

```bash
git add deploy/helm/platform-service/
git commit -m "feat: add generic Helm chart for platform services"
```

---

## Task 2: Per-service values files

Create `deploy/helm/platform-service/values-<svc>.yaml` for each of the 11 services.
Each file overrides only what differs from defaults. Read each service's `cmd/server/main.go`
to find the actual HTTP port it listens on (from `config.Load("...")`).

**Template for each service (adjust port and resources):**
```yaml
# values-<svc>.yaml
nameOverride: "<svc>"

image:
  repository: ghcr.io/Shreesh-Sree/CoderQX/<svc>
  tag: ""   # injected at deploy time

service:
  port: 8080   # check actual port from service config

envFrom:
  - secretRef:
      name: "{{ .Release.Name }}-secrets"
```

**Special overrides:**
- `gateway`: `service.type: LoadBalancer`, `replicaCount: 3`, `autoscaling.enabled: true`
- `analytics`: `resources.limits.memory: 1Gi` (projection workers are memory-heavier)
- `submission`: `resources.limits.cpu: "1"` (evaluation workloads can spike)

Read each service's README for documented ports and resource notes.

### Lint all 11 values files

```bash
for svc in gateway identity tenant user question-bank assessment submission judge seb notification analytics; do
  helm lint deploy/helm/platform-service/ -f deploy/helm/platform-service/values-${svc}.yaml || exit 1
done
```

### Step: Write deploy/helm/README.md

Document:
1. How to create the secrets Secret before deploying
2. How to deploy with `helm install <svc> deploy/helm/platform-service/ -f values-<svc>.yaml --set image.tag=sha256:...`
3. How to roll back: `helm rollback <svc>`

### Commit

```bash
git add deploy/helm/platform-service/ deploy/helm/README.md
git commit -m "feat: add per-service Helm values and deployment README"
```

---

## Completion checklist

- [ ] `helm lint deploy/helm/platform-service/ -f values-<svc>.yaml` exits 0 for all 11 services
- [ ] `helm template` output is valid (no template errors)
- [ ] deploy/helm/README.md documents the deployment workflow
- [ ] `make build` and `make lint` still pass (no Go changes)
