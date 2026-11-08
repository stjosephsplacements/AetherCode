# Frontend

The AetherCode platform's web UI (roadmap M5). It talks only to the Go platform
through the gateway and has no database or grading logic of its own (ADR-0017).
The look is a calm, Claude.ai-inspired product UI: a warm neutral canvas, one
terracotta accent, Geist for the interface, Source Serif 4 for display
headings only, Geist Mono for code. Light and dark follow the operating
system. Tokens live in `src/app/globals.css`; controls use a 10px radius and
surfaces 16px. Exam times are shown in `NEXT_PUBLIC_TIME_ZONE` (default
`Asia/Kolkata`), because pages render on a server that may run in UTC.

Stack: Next.js 16 (App Router), React 19, TypeScript 7 (`tsc`; typescript-eslint
and Next's build use the TS 6 API through the `typescript` alias, as Microsoft
recommends until TS 7.1), Tailwind CSS 4, Radix UI, Monaco, pnpm.

## Running

```
pnpm install
GATEWAY_URL=http://127.0.0.1:8380 PUBLIC_ORIGIN=http://localhost:3000 pnpm dev
pnpm typecheck && pnpm lint && pnpm build
```

| Variable | Meaning |
|---|---|
| `GATEWAY_URL` | Where the Next.js server reaches the gateway (`http://gateway:8080` in Compose). |
| `PUBLIC_ORIGIN` | The origin students load the site from. Must equal the gateway's `GATEWAY_SEB_PUBLIC_ORIGIN`. Mutating `/api` requests must carry it as `Origin`. |
| `BRANDING_FILE` | Optional. A JSON file of per-college branding (ADR-0045). |

### Branding

`BRANDING_FILE` points at a JSON file; logos are files beside it. The server
re-reads it when it changes.

```json
{
  "default": { "name": "AetherCode" },
  "tenants": {
    "018f4b0d-08f8-7c09-9ba7-efdf9c220001": { "name": "St. Joseph's", "color": "#2563eb", "logo": "sjc.png" }
  }
}
```

A college's entry overrides `default`. `logos` (up to five file names, shown in
that order) replaces the single `logo` when a college has several marks. `color` must be a `#rrggbb` mid-tone
that reads on both the light and the dark canvas (relative luminance 0.12 to
0.30); a colour outside that range, or a logo name with a path, is dropped
with a warning in the server log. `logo` is a png, jpg, webp or svg file name
in the same directory. The sign-in page keeps the AetherCode mark.

`pnpm build` emits `.next/standalone`; copy `public/` and `.next/static/` beside
`server.js` and run `node server.js`.

## How it talks to the platform

- **Sessions.** Sign-in is a server action. The access and refresh tokens live in
  `httpOnly`, `SameSite=Strict` cookies, and the browser never sees them.
  `src/proxy.ts` rotates the refresh token before any page or `/api` request
  whose access token expires within a minute. Identity revokes the whole session
  when a refresh token is replayed, so each rotation runs once per process and
  its result is reused for 30 s by requests still carrying the old cookie. This
  assumes one Next.js process; run more only with sticky sessions.
- **`/api/*`.** `src/app/api/[...path]/route.ts` forwards to the gateway under
  the same path and query and adds the bearer from the cookie. Safe Exam Browser
  hashes `PUBLIC_ORIGIN + path`, and the gateway rebuilds exactly that URL, so
  SEB-locked requests verify unchanged. Token endpoints
  (`/api/identity/v1/auth/*`) are not exposed.
- **SEB-locked routes are called from the browser.** Every `/api/submission/...`
  call (start, paper, save, run, submit) is made by client components. A
  server-side fetch would not carry SEB's per-request hash.
- **SEB entry.** The `.seb` launch file starts at `/exam/<exam id>`, which sends
  the student (after sign-in) to that exam's lobby. SEB quits at `/student`.

## Screens

| Route | Screen |
|---|---|
| `/login` | Sign-in by roll number or username (with MFA step) |
| `/account/password` | Change-password gate for issued passwords (ADR-0036) |
| `/account/security` | TOTP enrolment and recovery codes |
| `/exam/<exam>` | Safe Exam Browser start page (redirects to assignment) |
| **Student** | |
| `/student` | Dashboard: open exams, upcoming, practice, performance |
| `/student/exams/<assignment>` | Lobby: window, duration, instructions, start/resume, SEB launch file |
| `/student/attempts/<attempt>` | HackerRank-style exam screen: question rail, Monaco editor, Run/Submit, timer, autosave |
| `/student/completed` | Finished exams and results (after result release) |
| `/student/practice` | Practice problems by topic |
| `/student/performance` | Streaks, practice progress, exam history |
| `/student/profile` | Public profile and community links |
| **Staff** | |
| `/staff` | Staff landing with recent activity |
| `/staff/exams` | Exam list, create, duplicate |
| `/staff/exams/<exam>` | Exam detail: version, items, pools, settings, lockdown, publish |
| `/staff/exams/<exam>/monitor` | Live monitor with WebSocket updates, announcements, extend time |
| `/staff/exams/<exam>/results` | Results, CSV export, result release |
| `/staff/exams/<exam>/similarity` | Similarity report |
| `/staff/questions` | Question bank, authoring, model-solution checks |
| `/staff/students` | Student roster, bulk import, individual detail |
| `/staff/roles` | College role management with permission grids |
| `/staff/calendar` | Exam calendar |
| `/staff/community` | Community content moderation |
| `/staff/audit` | Staff audit log |
| `/staff/status` | Service health and judge queue |
| **Admin** | |
| `/admin` | Platform overview with college tiles |
| `/admin/incidents` | Cross-college incident board with real-time updates |
| `/admin/colleges` | College CRUD |
| `/admin/admins` | Platform administrator management |
| `/admin/analytics` | Prometheus service metrics (live polling) |
| **Placement** | |
| `/placement` | Placements dashboard: students by track across colleges |
| `/placement/departments` | Placement organisation and department CRUD (PEP, HOPE, ELITE) |
| `/placement/staff` | Assign and manage placement officers |
| `/placement/questions` | Shared question bank (read-only for placement staff) |
| `/placement/exams` | Cross-college exam listing |

## Backend contracts

All gateway endpoints are documented in each service's `api/openapi.yaml`.
TypeScript shapes are in `src/lib/api-types.ts`.

## Third-party licenses

The public pages animate with [GSAP](https://gsap.com) (`gsap`, `@gsap/react`, including ScrollTrigger and SplitText). GSAP is free to use but is not open source: it ships under GSAP's own [Standard "no charge" license](https://gsap.com/standard-license), not the AGPL. Anyone redistributing a fork should read that license. Everything else in this app is under OSI-approved licenses.
