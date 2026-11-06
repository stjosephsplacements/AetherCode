# ADR-0074: Database pods run without the default AppArmor profile on hosts that deny signals

- Status: accepted
- Date: 2026-11-06

## Context

On the campus server (kernel 7.0.0-42 and later) the node's default AppArmor profile for containers
denies signals between processes of the same container. This showed up three ways:

1. ingress-nginx could not reload (`kill(.., 1) failed (13: Permission denied)`), answered 502, and was
   patched by hand to `appArmorProfile: Unconfined` plus the `KILL` capability.
2. PostgreSQL 18 "asynchronous I/O hung", and was patched to `io_method=sync`.
3. During the 2026-11-05 test run, `pg_reload_conf()` and `pg_terminate_backend()` failed with
   "Permission denied", the PostgreSQL 17 image's init could not stop its temporary server
   (`pg_ctl: could not send stop signal`), and backends hung for good: a backend holding the
   relation-extension lock of `app.outbox_events` waited in `Lock:extend` with nothing blocking it, so a
   100-student import never returned, and the analytics partition function queued 30+ sessions for hours.
   `io_method=sync` and `file_extend_method=write_zeros` did not remove these hangs.

PostgreSQL wakes a waiting backend with a signal, so a denied signal is a lost wake-up.

## Decision

- The infra chart takes `postgres.appArmorUnconfined` and `judgeDb.appArmorUnconfined`, which set
  `securityContext.appArmorProfile.type: Unconfined` on the database containers. The campus server
  sets both through `deploy/helm/values-infra-kernel-workaround.yaml`.
- The `io_method=sync` and `file_extend_method=write_zeros` settings are dropped from that file (the
  chart keeps `ioMethod` and `fileExtendMethod` for hosts that want them). Defaults are back.
- The PostgreSQL image is 18.6.
- Other pods keep the default profile. ingress-nginx still needs its own fix; it has the same cause.

## Consequences

- With this setting on the campus server: `pg_reload_conf()` returns true, five consecutive 500-student
  imports took 2.7 to 3.6 s each (they had hung), and a 1,000-student exam load test completed with
  every API step in milliseconds.
- A database container without AppArmor confinement is a weaker sandbox. The pods run as a non-root user
  with all capabilities dropped and no privilege escalation, and a database pod has no untrusted code.
- Hosts without this kernel behaviour do not need the setting; it stays off by default.
