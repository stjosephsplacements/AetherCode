{{- define "judge-control.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "judge-control.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "judge-control.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "judge-control.labels" -}}
app.kubernetes.io/name: {{ include "judge-control.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/part-of: judge-control
{{- end }}

{{- define "judge-control.selectorLabels" -}}
app.kubernetes.io/name: {{ include "judge-control.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "judge-control.image" -}}
{{- $repository := required "image.repository is required" .repository -}}
{{- $digest := required "image.digest is required; production images must be pinned by digest" .digest -}}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" $digest) -}}
{{- fail "image.digest must be a lowercase sha256 digest" -}}
{{- end -}}
{{- printf "%s@%s" $repository $digest -}}
{{- end }}

{{- define "judge-control.validate" -}}
{{- if lt (int .Values.replicaCount) 3 }}{{ fail "judge-control requires at least three warm wrapper replicas" }}{{ end }}
{{- if not .Values.runtimeSecret.name }}{{ fail "runtimeSecret.name is required" }}{{ end }}
{{- if not .Values.tls.secretName }}{{ fail "tls.secretName is required; the wrapper API is mTLS-only in Kubernetes" }}{{ end }}
{{- if empty .Values.tls.allowedClientSubjects }}{{ fail "tls.allowedClientSubjects is required; mTLS client subjects must be allowlisted" }}{{ end }}
{{- if .Values.rabbitmq.enabled }}
{{- if lt (int .Values.rabbitmq.replicas) 3 }}{{ fail "RabbitMQ requires three quorum members" }}{{ end }}
{{- if not .Values.rabbitmq.authSecretName }}{{ fail "rabbitmq.authSecretName is required" }}{{ end }}
{{- if not .Values.networkPolicy.apiServerCIDR }}{{ fail "networkPolicy.apiServerCIDR is required for RabbitMQ Kubernetes peer discovery" }}{{ end }}
{{- end }}
{{- if .Values.engine.enabled }}
{{- if not .Values.engine.compatibilityApproved }}{{ fail "Judge0 cannot be enabled until the gVisor compatibility gate is approved" }}{{ end }}
{{- if not .Values.engine.compatibilityEvidenceRef }}{{ fail "Judge0 cannot be enabled without signed gVisor compatibility evidence" }}{{ end }}
{{- if not .Values.engine.endpoint }}{{ fail "engine.endpoint is required when Judge0 is enabled" }}{{ end }}
{{- if not .Values.engine.authSecretName }}{{ fail "engine.authSecretName is required when Judge0 is enabled" }}{{ end }}
{{- end }}
{{- if .Values.databaseHA.enabled }}
{{- if not .Values.databaseHA.imageName }}{{ fail "databaseHA.imageName is required when provisioning the CNPG cluster" }}{{ end }}
{{- if not .Values.databaseHA.storageClass }}{{ fail "databaseHA.storageClass is required when provisioning the CNPG cluster" }}{{ end }}
{{- if not .Values.databaseHA.backupPluginName }}{{ fail "databaseHA.backupPluginName is required for WAL archiving" }}{{ end }}
{{- if not .Values.databaseHA.backupObjectStoreRef }}{{ fail "databaseHA.backupObjectStoreRef is required for WAL archiving" }}{{ end }}
{{- else if not .Values.databaseHA.externalHAEvidenceRef }}
{{- fail "databaseHA.enabled must be true or databaseHA.externalHAEvidenceRef must identify the approved external three-node HA control database" }}
{{- end }}
{{- end }}
