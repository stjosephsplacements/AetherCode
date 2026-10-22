{{- define "infra.labels" -}}
app.kubernetes.io/part-of: aethercode
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end }}

{{/* A secret key as an environment variable. */}}
{{- define "infra.secretEnv" -}}
- name: {{ .name }}
  valueFrom:
    secretKeyRef:
      name: {{ .secret }}
      key: {{ default .name .key }}
{{- end }}

{{/* The restricted pod security context shared by the images that tolerate it. */}}
{{- define "infra.podSecurity" -}}
runAsNonRoot: true
seccompProfile:
  type: RuntimeDefault
{{- end }}
