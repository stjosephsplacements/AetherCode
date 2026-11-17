# ADR-0083: Traefik replaces ingress-nginx

- Status: accepted (owner approved 2026-11-17); applied to the campus server the same day
- Date: 2026-11-17

## Context

The Kubernetes `ingress-nginx` project is retired upstream, so it no longer gets security
fixes. All traffic reaches the cluster through a Cloudflare Tunnel that forwards to the
controller on port 80, and LAN clients use ports 80 and 443 directly. Eighteen Ingresses
used nginx annotations (body size, timeouts, SSL redirect) and two used snippet annotations.
The controller's ConfigMap held an allow-list of Cloudflare and cluster ranges, real-IP
handling and global timeouts.

## Decision

Run Traefik (chart 42.4.1, v3.7.19) as a DaemonSet on host ports 80 and 443. Its
nginx-compatible provider reads the existing `nginx`-class Ingresses, so they were not
edited. The rest is in `deploy/single-node/`:

- `traefik-values.yaml`: forwarded headers trusted from cloudflared and the cluster, the same
  600 s timeouts, a default entry-point middleware that only allows Cloudflare and cluster
  ranges (the old `allow-cidrs`), and the nginx provider.
- `traefik-extras.yaml`: that allow-list middleware, and native replacements for the two
  snippet Ingresses (`cdn.` headers and path rewrite, `www.algoqx.tech` redirect to the apex).
- Six NetworkPolicies that admitted `ingress-nginx` also admit the `traefik` namespace.

The move used Traefik on staging ports 8081/8444, a host-by-host comparison of status codes
against nginx, a temporary tunnel route to 8081, removal of nginx, and a rebind to 80/443.

## Consequences

- `www.algoqx.tech` now answers 301 instead of 308 (same for GET).
- Traefik answers LAN HTTPS with the `*.stjosephsplacements.in` certificate where nginx
  served its fake default certificate.
- Real client IP reaches backends through `X-Forwarded-For` as sent by Cloudflare; nginx also
  copied `CF-Connecting-IP` to `X-Real-IP`, which Traefik does not. Check any service that
  reads `X-Real-IP`.
- The allow-list is not tested against a denied source.
- Envoy Gateway remains the option if everything later moves to Gateway API.
