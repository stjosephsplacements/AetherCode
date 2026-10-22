{{/* Expand the name of the chart. */}}
{{- define "platform-service.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Fully qualified app name. Releases are named after the service, so this is the in-cluster DNS name. */}}
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

{{/* Common labels */}}
{{- define "platform-service.labels" -}}
helm.sh/chart: {{ include "platform-service.chart" . }}
{{ include "platform-service.selectorLabels" . }}
app.kubernetes.io/part-of: aethercode
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* Selector labels: the name is the service, which network policies select on. */}}
{{- define "platform-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "platform-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "platform-service.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "platform-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "platform-service.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/* The Secret that holds platform credentials unless an entry names another. */}}
{{- define "platform-service.secretName" -}}
{{- required "global.secretName is required" .Values.global.secretName -}}
{{- end }}

{{/* Image reference: a digest wins over a tag. A tag is always required, so an install never runs an unintended image. */}}
{{- define "platform-service.image" -}}
{{- $repository := required "image.repository is required" .Values.image.repository -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" $repository .Values.image.digest -}}
{{- else -}}
{{- printf "%s:%s" $repository (required "image.tag or image.digest is required (pass the CI build's tag with --set image.tag=...)" .Values.image.tag) -}}
{{- end -}}
{{- end }}

{{/* All plain configuration: the shared defaults, then the service's own, templated. */}}
{{- define "platform-service.config" -}}
{{- $merged := merge (deepCopy .Values.config) (deepCopy .Values.commonConfig) -}}
{{- range $key, $value := $merged }}
{{ $key }}: {{ tpl (toString $value) $ | quote }}
{{- end }}
{{- end }}
