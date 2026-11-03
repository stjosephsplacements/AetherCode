# Question intake

A small app beside the platform, so question authoring does not wait on platform development. Staff sign in
with their normal AetherCode account, write a question with its tests and model solutions, and the hosted
judge must pass every solution on every test before the question can be saved. Everything goes into its own
database; the platform's question bank is untouched. Import into it later.

- **Sign in**: the platform's identity service through the gateway (`/identity/v1/auth/login`, then `/user/v1/me`).
  Staff roles only; students are refused. Tokens live in httpOnly cookies and rotate in `proxy.ts`.
- **Database**: its own Postgres database `question_intake` (`db/*.sql`, `pnpm migrate`). Tables: `questions`,
  `question_tests`, `question_solutions`, `verifications` (every judge run, kept for audit).
- **Judge**: the hosted AetherCode Execution Engine (`ENGINE_URL`). `lib/engine.ts` submits one run per solution
  (compile once, every test input) and reads the streamed verdict; `lib/compare.ts` compares output the way the
  exam app does (line endings, trailing whitespace and blank lines ignored).
- **Verify, then save**: `POST /api/verify` runs the judge and, on success, returns a token that signs the
  content hash (title, difficulty, statement, limits, tests, solutions) for 30 minutes, bound to the person.
  The save action refuses anything without a valid token for that exact content, and the editor disables Save
  after any change to what was verified.
- **Languages**: C, C++, Java, Python 3, JavaScript, Go, Rust, Ruby, PHP, C#.

## Run

```
cp .env.example .env.local      # fill in DATABASE_URL, GATEWAY_URL, ENGINE_URL, VERIFY_SECRET
pnpm install
pnpm migrate
pnpm dev                        # http://localhost:3300
pnpm test && pnpm typecheck
```

`GATEWAY_URL` includes `/api` (for example `http://127.0.0.1:8380/api`). The database and the engine are
reached however the host reaches them; on the dev cluster, through an SSH tunnel to the Postgres pod and to the
`aethercode-exec-svc` service (port 5100).

## Deploy (production k3s server)

Live at `https://questions-aethercode.stjosephsplacements.in` (Cloudflare tunnel to the nginx ingress, like
`api-aethercode.*`). `questions.aethercode.stjosephsplacements.in` is also routed, but it is two levels deep and
Cloudflare's Universal certificate (`*.stjosephsplacements.in`) does not cover it: it works once an Advanced
Certificate Manager certificate for that host is ordered in the Cloudflare dashboard.

- Namespace `question-intake`, `deploy/question-intake.yaml` (2 replicas, init container runs `scripts/migrate.mjs`).
- Database `question_intake` in the production CloudNativePG cluster (`postgres-cluster-rw.production.svc`), role
  `question_intake`. Secret `question-intake-env` holds `DATABASE_URL` and `VERIFY_SECRET` (created on the server,
  never committed).
- The app reaches the platform gateway and the engine in the `aethercode` namespace through two NetworkPolicies in
  `deploy/question-intake.yaml` (that namespace denies ingress by default).
- Build on the server: `COPYFILE_DISABLE=1 tar` the app directory over, `buildah bud -t question-intake:<sha>`, push to a
  docker archive and `ctr -n k8s.io images import`, then `sed s/IMAGE_TAG/<sha>/ deploy/question-intake.yaml | kubectl apply -f -`.
