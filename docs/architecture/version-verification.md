# Version verification

Context7 is not available in this workspace. The initial pins below were
verified against upstream project documentation and release/module registries
on 2026-07-24; renew the check before upgrading any dependency.

| Component | Initial pin |
|---|---|
| Go toolchain | `go1.26.5` |
| PostgreSQL | `18.4` |
| CloudNativePG | `1.30.x` |
| CloudNativePG PostgreSQL operand | `18.4-system-trixie` (`sha256:9287ce030c6f3ce822e383b019ae4aaf1e8370bff3b39f9c51dc10d69dc97219`) |
| Barman Cloud CNPG-I | `0.13.0` |
| pgx | `v5.10.0` |
| golang-migrate | `v4.19.1` |
| Casbin | `v2.135.0` |
| NATS Go client | `v1.52.0` |
| RabbitMQ Go client | `amqp091-go v1.13.0` |
| Buf CLI | `v1.72.0` |
| gRPC Go | `v1.82.1` |
| protobuf Go | `v1.36.11` |
| Judge0 CE | `v1.13.1` compatibility spike only |

Judge0 is not approved for production until the gVisor, no-network, and
non-privileged compatibility gate passes. The upstream sample deployment is
reference-only because it requests privileged containers.

CloudNativePG `1.30.x` is selected because it supports PostgreSQL 18.4,
quorum synchronous replication, declarative database roles, and safe primary
promotion leases. Its Barman Cloud plugin supplies encrypted WAL/base backups
and PITR; the production chart remains render-gated until a verified
India-resident object-store endpoint and certificate secrets are supplied.
