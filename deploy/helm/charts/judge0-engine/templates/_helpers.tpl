{{- define "judge0-engine.name" -}}
{{- .Chart.Name }}
{{- end }}

{{- define "judge0-engine.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "judge0-engine.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "judge0-engine.labels" -}}
app.kubernetes.io/name: {{ include "judge0-engine.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/part-of: judge-engine
{{- end }}

{{- define "judge0-engine.selectorLabels" -}}
app.kubernetes.io/name: {{ include "judge0-engine.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "judge0-engine.image" -}}
{{- $repository := required "image.repository is required" .Values.image.repository -}}
{{- $tag := required "image.tag is required" .Values.image.tag -}}
{{- $digest := required "image.digest is required" .Values.image.digest -}}
{{- if ne .Values.image.engineVersion "1.13.1" }}{{ fail "Only Judge0 CE 1.13.1 is currently eligible for the compatibility gate" }}{{ end }}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" $digest) }}{{ fail "image.digest must be a lowercase sha256 digest" }}{{ end }}
{{- printf "%s:%s@%s" $repository $tag $digest -}}
{{- end }}

{{- define "judge0-engine.validate" -}}
{{- if not .Values.enabled }}{{ fail "Judge0 engine rendering is disabled; set enabled=true only after the compatibility gate is approved" }}{{ end }}
{{- if not .Values.compatibilityGate.approved }}{{ fail "Judge0 engine rendering is blocked until the gVisor compatibility gate is approved" }}{{ end }}
{{- if not .Values.compatibilityGate.evidenceRef }}{{ fail "compatibilityGate.evidenceRef is required" }}{{ end }}
{{- if ne .Values.runtimeClassName "gvisor" }}{{ fail "Judge0 must use the gvisor RuntimeClass" }}{{ end }}
{{- if lt (int .Values.server.replicas) 3 }}{{ fail "Judge0 requires at least three server replicas" }}{{ end }}
{{- if lt (int .Values.worker.replicas) 3 }}{{ fail "Judge0 requires at least three warm worker replicas" }}{{ end }}
{{- if not .Values.runtimeSecret.name }}{{ fail "runtimeSecret.name is required" }}{{ end }}
{{- if not .Values.engineDatabase.haEvidenceRef }}{{ fail "engineDatabase.haEvidenceRef is required to prove the separate version-pinned Judge0 engine database HA deployment" }}{{ end }}
{{- end }}
