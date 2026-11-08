# ADR-0076: ingress-nginx controller runs without the default AppArmor profile on hosts that deny signals

- Status: accepted
- Date: 2026-11-08

## Context

On the campus server (kernel 7.0.0-42 and later) the node's default AppArmor profile for containers
denies signals between processes of the same container. This is the same root cause as ADR-0074
(PostgreSQL and judge-db). ingress-nginx is affected differently:

1. The controller sends `SIGHUP` to reload the nginx worker processes after a config change and
   `SIGQUIT` to terminate old workers during a graceful reload. Both fail with "Permission denied".
2. As a result: new routes never take effect (the old nginx worker keeps running), the controller
   log fills with `kill(.., 1) failed (13: Permission denied)`, and pods answer 502 for new
   routes.
3. During pod termination the orphaned `nginx-ingress-controller` and `nginx` processes stay on
   the host holding port 10245 (the controller's health check port). The next controller pod
   cannot start until those processes are killed manually.

The same fix applied to postgres — `appArmorProfile.type: Unconfined` — resolves it. For
ingress-nginx (installed via the community Helm chart, not managed by `platform-infra`) this is
done through chart values rather than through the `platform-infra` chart.

## Decision

- `deploy/helm/values-ingress-nginx-kernel-workaround.yaml` is provided alongside the existing
  `values-infra-kernel-workaround.yaml`. It sets `container.apparmor.security.beta.kubernetes.io/controller: unconfined`
  via pod annotations and adds `KILL` to the controller's capability set (required so the process
  manager can signal arbitrary descendant processes).
- The campus server applies this override with:
  ```
  helm upgrade ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx \
    -f values-ingress-nginx-kernel-workaround.yaml
  ```
- The values file is idempotent: re-running the command on a host that does not need it costs
  nothing beyond an annotation and a capability that the controller already has in practice.
- The earlier kubectl patch (`kubectl patch daemonset/deployment … --type merge -p '{"spec":…}'`)
  is superseded by this file. The hand-applied patch is equivalent; the file makes it reproducible
  across reinstalls and controller version upgrades.

## Consequences

- After applying: the controller can send `SIGHUP`/`SIGQUIT`; config reloads succeed; new ingress
  routes take effect without restarting the pod; pod termination is clean.
- Removing the AppArmor profile weakens the MAC layer for the ingress-nginx controller pod.
  The controller already runs with all capabilities dropped except `NET_BIND_SERVICE`; this fix
  adds `KILL` and removes AppArmor, both common in production ingress-nginx deployments on
  AppArmor-strict hosts. The seccomp profile is unchanged.
- Hosts without this kernel behaviour do not need the file; the standard chart values apply
  the default profile implicitly.
- If the AppArmor policy is later updated to permit signals, this override can be removed; the
  annotation is the only place that records the workaround.
