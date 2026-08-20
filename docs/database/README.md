# Database architecture

Each service owns a logical database and applies only its own migrations. The
platform PostgreSQL HA cluster contains `aether_identity`, `aether_tenant`,
`aether_users`, `aether_qbank`, `aether_assessment`, `aether_submission`,
`aether_seb`, `aether_notification`, and `aether_analytics`.

Judge control state lives in `aether_judge_wrapper` on a separate Judge control
cluster. Judge0's opaque engine database is a separate PostgreSQL 16-compatible
deployment; wrapper code never queries it directly.

Every database has non-login owner, migrator, application, authorization-reader,
and projection-worker roles. Application roles are neither owners nor
`BYPASSRLS` roles. See each service migration README for ownership and rollback
rules. [Migration verification](migration-verification.md) documents the
dedicated-migrator version ledger and disposable fresh-up/down/up check.
