# ADR-0048: Community content in the notification service

- Status: accepted
- Date: 2026-10-21

## Context

The earlier AetherCode (the "Final" app) gave students more than exams:
interview experiences approved by the placement team, blogs, contest,
hackathon and open-source listings with bookmarks, linked LeetCode, GitHub,
Codeforces and CodeChef accounts, and a personal task list. This platform had
none of it. The data is tenant-scoped, read by students and written by both
students and staff.

## Decision

**It lives in the notification service** (migration `000013`), the service
that already serves students inside a tenant with the `self` pattern. A
twelfth service would need its own database, roles, mTLS certificates,
projection consumers, gateway upstream and deployment entries for six small
tables. If the content grows, splitting it out is a move of one migration and
one handler file.

**Every table is reachable only through owner-bound functions.** Row-level
security is forced and gives the application role no policy and no grant. Each
`notification.community_*` function checks the signed context itself:

| Resource | Who | Used for |
|---|---|---|
| `community` | students (as themselves), staff | reading approved content, posting experiences, bookmarks, handles, tasks |
| `community_moderation` | staff only | approving experiences, writing blogs, managing listings |

The User service adds both resources to the notification route, a `self`
rule for students on `community` only (migration `000030`), and requires the
resource ID to be the bearer subject, as for notifications. Students hold no
rule for `community_moderation`; mentors can read it but not write.

**Rules in the functions.** Interview experiences are `pending` until staff
approve or send them back, are shown without their author's identity, and can
be deleted by their author. Blog drafts are invisible to members. A listing's
`external_id` makes re-importing update rather than duplicate. Bookmarks,
handles and tasks belong to the signed actor.

**One generic HTTP layer.** `community.go` maps each route to a fixed function
name; the body, query string and path values are merged into one JSON object
(path values win) and passed through. The service refuses any name not in its
allow-list.

**External data is fetched by the web server, not by the platform.** The
sandboxed backend gets no new network path. Staff press "Import" to pull
Codeforces' public `contest.list` and GitHub's "good first issue" search
into listings through the normal API. Students' profile pages read public
numbers (Codeforces `user.info`, GitHub users, LeetCode GraphQL) from the
frontend server with a one-hour cache; CodeChef and HackerRank have no public
API and show a link only. All of it is best effort: a site that does not
answer shows no numbers.

## Consequences

- Listings are per college, not shared across colleges, and blogs have no
  "selected colleges" visibility.
- Imported listings are as fresh as the last import; there is no scheduled sync.
- The LeetCode GraphQL endpoint is not a documented public API and may change.
- Deleting is a hard delete for these rows (they are not academic records).
- Deploy order: user `000030` and the User service first, then notification
  `000013` and its service, then the frontend.
