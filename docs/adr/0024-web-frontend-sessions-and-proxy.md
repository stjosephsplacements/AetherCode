# ADR-0024: Web frontend sessions and gateway proxy

- Status: accepted
- Date: 2026-10-19

## Context

M5 ports the exam app's screens onto the platform in `frontend/`. The
frontend must keep tokens away from page scripts, keep Safe Exam Browser's
per-request checks working (ADR-0022), and survive an exam's request pattern:
autosave, run polling and submit, all at once, for up to twelve hours.

Two platform behaviours shape the design:

- Identity treats a refresh token presented twice as theft and revokes the
  whole session (`RotateRefresh`). Two requests refreshing in parallel would
  log a student out mid-exam.
- Gateway checks SEB's `X-SafeExamBrowser-RequestHash` against
  `PUBLIC_ORIGIN + RequestURI` of the request it receives. SEB computes it
  from the URL the browser loaded.

## Decision

- **Stack.** Next.js 16 (App Router) with React 19, Tailwind CSS 4, Radix UI
  and Monaco, built with pnpm as a standalone Node server. TypeScript 7 runs
  `tsc`. typescript-eslint and Next's build use the TypeScript 6 API through
  the `typescript` alias, Microsoft's recommended setup until 7.1 ships an API.
  The visual language is a calm, Claude.ai-inspired product UI (warm
  neutrals, one terracotta accent, Geist with Source Serif 4 for display),
  in light and dark.
- **Tokens in cookies.** Sign-in is a server action. Access and refresh tokens
  are `httpOnly`, `SameSite=Strict`, and `Secure` when `PUBLIC_ORIGIN` is
  https. The browser never sees a token, and the token routes are not proxied.
- **One refresh per token.** `src/proxy.ts` (Next's request proxy) rotates the
  refresh token before any request whose access token expires within a
  minute. Rotations are single-flight per process, and each result is reused
  for 30 seconds by requests still carrying the old cookie. This assumes one
  Next.js process; more need sticky sessions or a shared store.
- **Same-path proxy.** `/api/<service>/...` is forwarded to the gateway under
  the identical path and query, adding the bearer from the cookie and
  forwarding SEB's headers. The URL SEB hashed is the URL the gateway
  rebuilds, so locked requests verify unchanged. Non-GET requests must carry
  `Origin: PUBLIC_ORIGIN`.
- **Exam calls from the browser.** Every Submission call is made by client
  components through `/api`. A server-side fetch during page rendering would
  carry no valid SEB hash for its own URL.
- **Who is signed in.** After sign-in the frontend reads `GET /user/v1/me`
  and the principal (ADR-0023) and caches the result in an `httpOnly` cookie.
  It only chooses navigation; services authorize every request.

## Consequences

- nginx must send `/` to the frontend instead of the gateway, and the
  frontend's network must be in `GATEWAY_TRUSTED_PROXY_CIDRS` so student
  addresses still reach the rate limiter and audit log.
- `PUBLIC_ORIGIN` must be identical in the frontend and the gateway.
- Monaco is served from `public/monaco`, copied from the package at build
  time, so the exam screen needs no CDN.
- Marks stay hidden after submission until result release exists (M6).
