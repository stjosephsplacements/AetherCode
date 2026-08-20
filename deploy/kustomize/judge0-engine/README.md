# Judge0 engine Kustomize gate

This entrypoint intentionally renders no Judge0 resources. It becomes usable
only after the gVisor compatibility gate supplies a signed evidence reference,
the tested hardened image digest, the engine-only runtime secret, and
`enabled: true`. It also requires an immutable evidence reference for the
separate version-pinned Judge0 engine database HA deployment and upstream
schema-migration record. The chart then refuses privileged mode, host
namespaces, host paths, Docker sockets, and non-gVisor RuntimeClasses.
