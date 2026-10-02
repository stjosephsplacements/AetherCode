<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — apps/exam-v1

Rules for agents working on the exam app. The repository-wide rules in
`../../AGENTS.md` and `../../CLAUDE.md` also apply; this file adds what is
specific to this app. Read `README.md` here first: it holds the features,
rules, data model and deployment.

This app is on **Next.js 16**:
- `cookies()`, `headers()`, `params` and `searchParams` are async;
- `next.config.ts` sets `agentRules: false` so `next dev` stops regenerating
  agent files. Keep the block above intact.

## What matters most

The app runs **real graded exams**. A bug during an exam costs students marks
and can't be undone. Prefer the boring, verified change.

**Load-bearing invariants. Do not break them; ask before changing them:**
1. **Server-side authorization everywhere:**
   - pages call `requireUser(...)`;
   - server actions re-check the role;
   - student API routes use `requireStudent()` + `requireOpenAttempt()`
     (`lib/attempts.ts`).
2. **Hidden tests stay hidden.** Students only get verdicts for hidden tests.
   Batched grading runs samples and hidden tests in separate engine jobs
   (`lib/grade.ts`).
3. **The server owns time.** `attempts.deadline_at` decides; drafts get
   `DRAFT_GRACE_SECONDS`; the worker auto-submits latest drafts after the
   deadline.
4. **Best submission counts**, per slot, by passed test weight
   (`lib/results.ts`).
5. **Client IP comes from nginx** (`deploy/nginx.conf` overwrites
   `X-Forwarded-For`). Never publish the `app` port.
6. **Applied migrations are immutable.** Add `db/NNN_name.sql`; never edit an
   existing one.

## Where code goes

| Kind of change | Place |
|---|---|
| Pure logic (grading, comparison, similarity, parsing, networking rules) | `lib/*.ts` with a `lib/*.test.ts` |
| Page data | the page's server component |
| Form mutations | `actions.ts` next to the page (server actions) |
| Data the exam screen polls | `app/api/**/route.ts`, wrapped in `handle()` |
| Background work | `worker/main.ts` |
| Engine support | `lib/engine.ts` (`Engine.execute`, optional `executeBatch`) |
| Schema | new `db/NNN_name.sql` |
| Deployment | `deploy/` |

`lib/` files import each other with explicit `.ts` extensions so `tsx` can run
the worker and scripts without the Next bundler. Keep that. `lib/db.ts`
connects on first use so `next build` works without a database; don't add
module-level code that needs one.

## Commands (run in this directory unless noted)

| Task | Command |
|---|---|
| Typecheck + unit tests | `make exam-check` (repo root) or `pnpm typecheck && pnpm test` |
| Production build | `make exam-build` (repo root) or `pnpm build` |
| Dev server / worker | `pnpm dev` / `pnpm worker` |
| Apply migrations | `pnpm migrate` |
| First admin | `pnpm create-admin <username> [name]` |
| Verify the engine | `pnpm engine-check` (must print "Engine OK") |
| Load test | `pnpm loadtest --url <base> --students N` / `pnpm loadtest --cleanup` |
| End-to-end browser test | `E2E_BASE_URL=<base> pnpm e2e` (app, worker and engine running) |
| Full deployment | `make exam-up` / `make exam-down` (repo root) |

Dependencies: pnpm enforces `minimumReleaseAge`. If a fresh version is
rejected, pin the previous release; don't relax the policy.

## Definition of Done (this app)

- `make exam-check` and `make exam-build` pass.
- New logic has table-style tests in `lib/*.test.ts`.
- Changes to grading, timing, access control or the exam screen were exercised
  in a browser against a running worker, using a production build (`next dev`
  hot reload can reset exam-screen state and hide or create timing bugs).
- Engine changes pass `pnpm engine-check`.
- Changes to any step of the exam flow keep `pnpm e2e` passing (see README "End-to-end test"); extend the spec when you add a step.
- `README.md` is updated: features, rules, config, data model as relevant.
