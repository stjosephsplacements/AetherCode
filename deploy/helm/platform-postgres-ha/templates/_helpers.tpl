{{- define "platform-postgres-ha.fullname" -}}
{{- .Values.cluster.name -}}
{{- end -}}

{{- define "platform-postgres-ha.requireProductionInputs" -}}
{{- $image := required "cluster.image must be an immutable OCI digest reference" .Values.cluster.image -}}
{{- if not (contains "@sha256:" $image) -}}
{{- fail "cluster.image must be pinned by immutable sha256 digest" -}}
{{- end -}}
{{- required "certificates.serverCASecret is required" .Values.certificates.serverCASecret -}}
{{- required "certificates.serverTLSSecret is required" .Values.certificates.serverTLSSecret -}}
{{- required "certificates.clientCASecret is required" .Values.certificates.clientCASecret -}}
{{- required "certificates.replicationTLSSecret is required" .Values.certificates.replicationTLSSecret -}}
{{- required "backup.destinationPath must point to India-resident object storage" .Values.backup.destinationPath -}}
{{- required "backup.endpointURL must be an HTTPS India-resident endpoint" .Values.backup.endpointURL -}}
{{- required "backup.credentialsSecret is required" .Values.backup.credentialsSecret -}}
{{- required "backup.endpointCASecret is required" .Values.backup.endpointCASecret -}}
{{- end -}}
