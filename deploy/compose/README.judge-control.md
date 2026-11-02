# Local Judge control plane

`judge-control.compose.yaml` starts only the wrapper dependencies: PostgreSQL
and RabbitMQ. All published ports bind to `127.0.0.1`; the Docker network is
internal; and no execution engine, Docker socket, privileged container, or
execution sandbox is included.

The profile pins PostgreSQL 18.4 and RabbitMQ 4.3.3 by immutable Docker digest.
It is a local control-plane validation profile, not a substitute for the
production three-node PostgreSQL and RabbitMQ quorum deployments.

Create an untracked local environment file from the example and start the
control plane:

```bash
cp deploy/compose/judge-control.env.example .judge-control.env
docker compose --env-file .judge-control.env \
  -f deploy/compose/judge-control.compose.yaml up -d
```

Run wrapper migrations using `make migrate SVC=judge DIR=up` with a local
migration identity after the control plane is healthy. The shared runner creates
the owner-controlled `golang-migrate` ledger through that identity's permitted
`SET ROLE`; it does not require `CREATE` on `public`. The init script creates
only non-login group roles and gives the local bootstrap user temporary
migration-role membership; it is not a production identity setup.

Do not add the execution engine to this compose file: it runs on its own host
(see [ADR-0028](../../docs/adr/0028-aethercode-execution-engine.md)).
