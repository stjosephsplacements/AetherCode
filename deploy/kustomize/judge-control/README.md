# Judge control-plane Kustomize entrypoint

This Kustomize entrypoint renders the `judge-control` Helm chart with
`kustomize build --enable-helm`. Its committed values file deliberately omits
image digests, secret names, and the Kubernetes API-server CIDR, so it cannot
accidentally create an insecure or unpinned deployment.

The deployment pipeline materializes a short-lived values file from the image
attestation, ExternalSecret names, and cluster inventory, then runs Helm or
Kustomize with the same validated values. It must set a three-replica wrapper,
three RabbitMQ quorum members, digest-pinned images, mTLS secret name, an
explicit client-certificate subject allowlist, and the control-plane API CIDR.
It must also either enable the managed `databaseHA` block or provide an
immutable `databaseHA.externalHAEvidenceRef` for the independently provisioned
three-node synchronous control database. The managed block is enabled only when
CloudNativePG v1.29+ and the Barman Cloud plugin ObjectStore are already
installed in India. When an engine endpoint is enabled, the values must also
set `engine.compatibilityApproved: true` and carry the same reviewed evidence
reference as the separately gated `judge0-engine` release.

The wrappers expose only gRPC mTLS on port 8443. Their port-8080 health endpoint
is pod-local and intentionally absent from the Service.
