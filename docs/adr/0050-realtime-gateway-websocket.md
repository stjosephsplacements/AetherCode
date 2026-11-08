# ADR-0050: Realtime updates over a gateway WebSocket

- Status: accepted
- Date: 2026-11-01

## Context

The staff console showed a snapshot from render time. The dashboard re-rendered
every minute, and the status page carried its own hardcoded list of services and
descriptions that could drift from what the gateway actually routes to.

The frontend is a backend-for-frontend: browsers never call the gateway, and a
Next.js route handler cannot hold a WebSocket open. Services already publish
versioned events to NATS JetStream (`AETHERCODE_EVENTS`), each carrying its
tenant, but nothing delivers them to browsers.

## Decision

**The gateway serves `GET /api/realtime` as a WebSocket.** The ingress sends that
one path to the gateway; everything else under `/api/` keeps going through the
frontend. The library is `github.com/coder/websocket`: small, context-aware and
maintained.

**Authentication is the session the browser already has.** A browser cannot set
`Authorization` on a WebSocket, so the gateway reads the access token from the
session cookie (`GATEWAY_REALTIME_ACCESS_COOKIE`, default `ac_access`) and
verifies it with the same verifier as every other request. The `Origin` header
must be one of `GATEWAY_REALTIME_ORIGINS`, which stops another site from
opening a socket with a visitor's cookie. The connection closes when the token
expires; the client reconnects with the refreshed cookie.

**Authorization is the user service's.** The token names only a principal, so on
connect the gateway calls the user service's `GET /v1/me` with the caller's own
token. Any authenticated user (staff or student) may connect. A connection is
scoped to one tenant the caller belongs to, and only college and platform
administrators receive service health.

**Messages are hints, never data.** An event of an allowlisted type for the
connection's tenant becomes `{"type":"changed","topic":...,"id":...}`; payloads
are never forwarded. The page then refetches through the same authorised APIs it
already uses, so the socket cannot widen what anyone can read. Topics:
`attempts` (`submission.attempt_*`), `grading`
(`submission.evaluation_requested`, `judge.completed`) and `activity`
(`user.staff_audit_recorded`). The gateway uses a core
NATS subscription: hints are best-effort, and a reconnecting client refetches
anyway.

**Service health comes from the gateway's own configuration.** The gateway probes
each configured upstream's `/healthz` every `GATEWAY_REALTIME_HEALTH_INTERVAL`
(default 5 s) and pushes the snapshot on connect and whenever it changes.
Optional descriptions come from `GATEWAY_SERVICE_DESCRIPTIONS` (a JSON object).
`GET /api/realtime/services` returns the same snapshot over HTTP for the first
render.

**Hints are optional.** Without `GATEWAY_REALTIME_NATS_URL` the socket still
carries service health; event hints are off.

## Consequences

- The status page and dashboard list exactly the services the gateway routes to.
- Live pages update within a second of an event instead of on a timer; when the
  socket is down the console falls back to a one-minute refresh.
- The staff audit log is pushed too: User migration `000031` makes
  `users.record_staff_action` also write `user.staff_audit_recorded.v1` (payload
  `{"allowed": bool}`, tenant set) to its outbox in the same call. Platform-wide
  actions without a tenant write no event.
- The ingress must allow WebSocket upgrades and long-lived connections on
  `/api/realtime`.
