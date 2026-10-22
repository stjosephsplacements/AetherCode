{{- define "migrations.labels" -}}
app.kubernetes.io/part-of: aethercode
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end }}

{{- define "migrations.image" -}}
{{- if .Values.image.digest -}}
{{ .Values.image.repository }}@{{ .Values.image.digest }}
{{- else -}}
{{ .Values.image.repository }}:{{ required "image.tag or image.digest is required" .Values.image.tag }}
{{- end -}}
{{- end }}

{{- define "migrations.secretEnv" -}}
- name: {{ .name }}
  valueFrom:
    secretKeyRef:
      name: {{ .secret }}
      key: {{ .name }}
{{- end }}

{{/* Pod settings shared by the three hook Jobs. */}}
{{- define "migrations.podSpec" -}}
restartPolicy: OnFailure
automountServiceAccountToken: false
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
securityContext:
  runAsNonRoot: true
  runAsUser: 999
  runAsGroup: 999
  seccompProfile:
    type: RuntimeDefault
{{- end }}
