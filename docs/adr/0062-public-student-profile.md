# ADR-0062: Opt-in public student profile

- Status: accepted
- Date: 2026-11-02

## Context

Students want a profile they can share with recruiters. The platform had no anonymous
read path except identity's sign-in routes, and a profile publishes a student's data.

## Decision

- A student turns it on. Nothing is public by default, and turning it off makes the address a 404 at once.
- `users.public_profiles` holds one row per student (address, on/off, a bounded JSON card). The app role has
  no table grant; three `SECURITY DEFINER` functions are the only way in: a public read by address (enabled
  rows only), and the student's own read and write, bound to the signed context actor.
- The card holds only what the student ticked (headline, about, skills, college, linked coding handles).
  It is built in the web app from their own account and linked handles, and the service bounds its size
  and shape (`SetPublicProfile.Normalise`). It carries no results, scores or roll number.
- The gateway lets exactly one route through without a sign-in: `GET /api/user/v1/public/profiles/{slug}`.
  It stays rate limited per IP like the other public routes.
- `/u/<slug>` renders the card. It is `noindex`: the student shares the link; search engines are not asked to list it.

## Limits

The card is what the student published; the service does not verify the college or the coding handles
against their sources, so the page says it is student-supplied. Verified practice statistics would
need a server-side aggregate and are left out.
