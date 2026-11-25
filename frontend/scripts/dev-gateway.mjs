#!/usr/bin/env node
/**
 * Local gateway stand-in for UI work when the campus tunnel is unreachable.
 * Not a security boundary — accepts any bearer after demo login.
 *
 *   node scripts/dev-gateway.mjs
 *   GATEWAY_URL=http://127.0.0.1:8380 PUBLIC_ORIGIN=http://localhost:3000 pnpm dev
 *
 * Demo accounts (password = role name): staff, student, admin
 */
import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.DEV_GATEWAY_PORT ?? 8380);
const TENANT = "0190a0a0-0000-7000-8000-000000000001";
const PRINCIPALS = {
  staff: {
    id: "0190a0a0-0000-7000-8000-000000000010",
    username: "staff",
    display_name: "Dev Staff",
    roles: [{ role_name: "college_admin", scope_kind: "college", tenant_id: TENANT, scope_id: TENANT }],
    student: null,
  },
  student: {
    id: "0190a0a0-0000-7000-8000-000000000020",
    username: "student",
    display_name: "Aria Dev",
    roles: [{ role_name: "student", scope_kind: "college", tenant_id: TENANT, scope_id: TENANT }],
    student: { tenant_id: TENANT },
  },
  admin: {
    id: "0190a0a0-0000-7000-8000-000000000001",
    username: "admin",
    display_name: "Dev Admin",
    roles: [{ role_name: "super_admin", scope_kind: "platform" }],
    student: null,
  },
};

function b64url(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

function mintToken(sub, hours = 8) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "none", typ: "JWT" });
  const payload = b64url({ sub, iat: now, exp: now + hours * 3600 });
  return `${header}.${payload}.dev`;
}

function tokenPair(sub) {
  const access = mintToken(sub, 8);
  const refresh = mintToken(sub, 24);
  const accessExp = new Date(Date.now() + 8 * 3600_000).toISOString();
  const refreshExp = new Date(Date.now() + 24 * 3600_000).toISOString();
  return {
    access_token: access,
    access_token_expires_at: accessExp,
    refresh_token: refresh,
    refresh_token_expires_at: refreshExp,
  };
}

function subjectFromAuth(req) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

function principalById(id) {
  return Object.values(PRINCIPALS).find((p) => p.id === id) ?? null;
}

function principalByUsername(username) {
  return PRINCIPALS[username.toLowerCase()] ?? null;
}

function page(items = []) {
  return { items, next_cursor: undefined };
}

function json(res, status, body) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type, idempotency-key, x-forwarded-for, x-tenant-id",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

const now = Date.now();
const opens = new Date(now - 3600_000).toISOString();
const closes = new Date(now + 7 * 86400_000).toISOString();
const examId = "0190a0a0-0000-7000-8000-000000000100";
const examVersionId = "0190a0a0-0000-7000-8000-000000000101";
const assignmentId = "0190a0a0-0000-7000-8000-000000000200";
const attemptId = "0190a0a0-0000-7000-8000-000000000210";
const contestId = "0190a0a0-0000-7000-8000-000000000220";
const practiceIds = {
  twoSum: "0190a0a0-0000-7000-8000-000000000601",
  reverse: "0190a0a0-0000-7000-8000-000000000602",
  binary: "0190a0a0-0000-7000-8000-000000000603",
  mcq: "0190a0a0-0000-7000-8000-000000000604",
};
const deptCse = "0190a0a0-0000-7000-8000-000000000301";
const deptEce = "0190a0a0-0000-7000-8000-000000000302";
const batchCseA = "0190a0a0-0000-7000-8000-000000000401";
const batchCseB = "0190a0a0-0000-7000-8000-000000000402";
const batchEceA = "0190a0a0-0000-7000-8000-000000000403";

const practiceProblems = [
  { question_id: practiceIds.twoSum, slug: "two-sum", title: "Two Sum", kind: "coding", difficulty: "easy", tags: ["arrays", "hash-map"], solved: true, attempted: true },
  { question_id: practiceIds.reverse, slug: "reverse-linked-list", title: "Reverse Linked List", kind: "coding", difficulty: "easy", tags: ["linked-list"], solved: true, attempted: true },
  { question_id: practiceIds.binary, slug: "binary-search", title: "Binary Search", kind: "coding", difficulty: "medium", tags: ["arrays", "binary-search"], solved: false, attempted: true },
  { question_id: practiceIds.mcq, slug: "big-o-basics", title: "Big-O Basics", kind: "mcq", difficulty: "easy", tags: ["complexity"], solved: true, attempted: true },
  { question_id: "0190a0a0-0000-7000-8000-000000000605", slug: "longest-substring", title: "Longest Substring Without Repeating", kind: "coding", difficulty: "medium", tags: ["strings", "sliding-window"], solved: false, attempted: false },
  { question_id: "0190a0a0-0000-7000-8000-000000000606", slug: "merge-intervals", title: "Merge Intervals", kind: "coding", difficulty: "medium", tags: ["arrays", "intervals"], solved: false, attempted: false },
  { question_id: "0190a0a0-0000-7000-8000-000000000607", slug: "word-break", title: "Word Break", kind: "coding", difficulty: "hard", tags: ["dp", "strings"], solved: false, attempted: false },
  { question_id: "0190a0a0-0000-7000-8000-000000000608", slug: "graph-bfs", title: "Shortest Path in an Unweighted Graph", kind: "coding", difficulty: "hard", tags: ["graphs", "bfs"], solved: false, attempted: false },
];

function practiceDetail(id) {
  const row = practiceProblems.find((problem) => problem.question_id === id);
  if (!row) return null;
  if (row.kind === "mcq") {
    return {
      question_id: row.question_id,
      question_version_id: `${row.question_id.slice(0, -1)}9`,
      kind: "mcq",
      title: row.title,
      prompt_markdown: "Which asymptotic bound best describes binary search on a sorted array?",
      difficulty: row.difficulty,
      languages: [],
      time_limit_ms: 2000,
      memory_limit_kib: 65536,
      tags: row.tags,
      samples: [],
      choices: ["O(n)", "O(log n)", "O(n log n)", "O(1)"],
      multiple_choice: false,
    };
  }
  return {
    question_id: row.question_id,
    question_version_id: `${row.question_id.slice(0, -1)}9`,
    kind: "coding",
    title: row.title,
    prompt_markdown: `## ${row.title}\n\nWrite a correct solution. Sample input is below.`,
    difficulty: row.difficulty,
    languages: ["python3", "cpp17", "c"],
    time_limit_ms: 2000,
    memory_limit_kib: 262144,
    tags: row.tags,
    samples: [{ input: "2\n1 2\n", expected_output: "3\n" }],
    starters: { python3: "def solve():\n    pass\n" },
  };
}

const collegeContests = [
  {
    id: contestId,
    title: "Friday Practice Sprint",
    description: "A short timed set of practice problems for CSE A.",
    starts_at: opens,
    ends_at: closes,
    lifecycle: "live",
    registered: true,
    question_ids: [practiceIds.twoSum, practiceIds.binary, practiceIds.mcq],
  },
];

const communityFeed = [
  {
    id: "0190a0a0-0000-7000-8000-000000000701",
    kind: "contest",
    title: "Codeforces Round (demo)",
    description: "Div. 2 practice contest listed for redesign work.",
    url: "https://codeforces.com",
    platform: "codeforces",
    starts_at: closes,
    ends_at: new Date(now + 8 * 86400_000).toISOString(),
    tags: ["cf", "div2"],
    bookmarked: false,
    phase: "upcoming",
  },
  {
    id: "0190a0a0-0000-7000-8000-000000000702",
    kind: "hackathon",
    title: "Campus Hack Night",
    description: "24-hour build challenge with mentors on site.",
    url: "https://example.com/hack",
    platform: null,
    starts_at: opens,
    ends_at: closes,
    tags: ["campus"],
    bookmarked: true,
    phase: "live",
  },
  {
    id: "0190a0a0-0000-7000-8000-000000000703",
    kind: "opensource",
    title: "Good first issues · AetherCode docs",
    description: "Docs and example PRs for first-time contributors.",
    url: "https://github.com",
    platform: "github",
    starts_at: null,
    ends_at: null,
    tags: ["docs", "beginner"],
    bookmarked: false,
    phase: "live",
  },
];

const interviewItems = [
  {
    id: "0190a0a0-0000-7000-8000-000000000711",
    company: "Example Soft",
    role: "SDE Intern",
    experience_level: "intern",
    drive_type: "on-campus",
    package_offered: "12 LPA",
    year_of_interview: 2026,
    preparation_resources: "LeetCode mediums + system design primers",
    rounds: [{ title: "OA", description: "Two coding questions" }, { title: "Technical", description: "DSA + projects" }],
    verdict: "selected",
    tips: "Talk through trade-offs out loud.",
    status: "approved",
    review_note: null,
    mine: false,
    created_at: opens,
    author_id: null,
  },
];

const blogItems = [
  {
    id: "0190a0a0-0000-7000-8000-000000000721",
    title: "How I prepared for campus drives",
    tags: ["placement", "tips"],
    status: "published",
    published_at: opens,
    updated_at: opens,
    excerpt: "A short walkthrough of a weekly practice routine.",
    body_markdown: "## Routine\n\n- Two easy problems before breakfast\n- One medium after labs\n",
  },
];

const taskItems = [
  { id: "0190a0a0-0000-7000-8000-000000000731", title: "Finish binary search practice set", due_at: closes, done: false },
  { id: "0190a0a0-0000-7000-8000-000000000732", title: "Update resume with internship", due_at: null, done: true },
];

/** In-memory college structure so the staff sidebar tree has something to show. */
const departments = [
  { id: deptCse, tenant_id: TENANT, code: "CSE", name: "Computer Science", department_type: "college", status: "active" },
  { id: deptEce, tenant_id: TENANT, code: "ECE", name: "Electronics", department_type: "college", status: "active" },
];
const batches = [
  { id: batchCseA, tenant_id: TENANT, department_id: deptCse, code: "CSE-A", name: "CSE A", academic_year: "2026-2030", status: "active" },
  { id: batchCseB, tenant_id: TENANT, department_id: deptCse, code: "CSE-B", name: "CSE B", academic_year: "2026-2030", status: "active" },
  { id: batchEceA, tenant_id: TENANT, department_id: deptEce, code: "ECE-A", name: "ECE A", academic_year: "2025-2029", status: "active" },
];

/** Managed college roles (ADR-0066 seed shape) so /staff/roles has something to render. */
const roles = [
  {
    id: "0190a0a0-0000-7000-8000-000000000501",
    guild_kind: "college",
    tenant_id: TENANT,
    name: "College admin",
    tier: 2,
    position: 500,
    permissions: ["question-bank.questions.read", "question-bank.questions.write", "assessment.exams.read", "assessment.exams.write", "user.students.read", "user.students.write"],
    managed: true,
    system_key: "college_admin",
    version: 1,
  },
  {
    id: "0190a0a0-0000-7000-8000-000000000502",
    guild_kind: "college",
    tenant_id: TENANT,
    name: "Department user",
    tier: 2,
    position: 300,
    permissions: ["question-bank.questions.read", "assessment.exams.read", "user.students.read"],
    managed: true,
    system_key: "department_user",
    version: 1,
  },
  {
    id: "0190a0a0-0000-7000-8000-000000000503",
    guild_kind: "college",
    tenant_id: TENANT,
    name: "Mentor",
    tier: 1,
    position: 200,
    permissions: ["assessment.exams.read", "user.students.read"],
    managed: true,
    system_key: "mentor",
    version: 1,
  },
  {
    id: "0190a0a0-0000-7000-8000-000000000504",
    guild_kind: "college",
    tenant_id: TENANT,
    name: "Student",
    tier: 1,
    position: 100,
    permissions: ["submission.attempts.read", "submission.attempts.write"],
    managed: true,
    system_key: "student",
    version: 1,
  },
  {
    id: "0190a0a0-0000-7000-8000-000000000505",
    guild_kind: "college",
    tenant_id: TENANT,
    name: "@everyone",
    tier: 1,
    position: 0,
    permissions: [],
    managed: true,
    system_key: "everyone",
    version: 1,
  },
];

function handle(pathname, method, body, sub, query = new URLSearchParams()) {
  if (pathname === "/api/readyz" || pathname === "/readyz" || pathname === "/api/healthz") {
    return { status: 200, body: { status: "ok", mode: "dev-gateway" } };
  }

  if (pathname === "/api/identity/v1/auth/login" && method === "POST") {
    const identifier = String(body?.identifier ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const person = principalByUsername(identifier);
    if (!person || password !== identifier) {
      return { status: 401, body: { code: "invalid_credentials", message: "wrong credentials" } };
    }
    return { status: 200, body: tokenPair(person.id) };
  }

  if (pathname === "/api/identity/v1/auth/refresh" && method === "POST") {
    const refresh = String(body?.refresh_token ?? "");
    try {
      const claims = JSON.parse(Buffer.from(refresh.split(".")[1] ?? "", "base64url").toString("utf8"));
      if (!claims.sub) return { status: 401, body: { code: "unauthenticated", message: "bad refresh" } };
      return { status: 200, body: tokenPair(claims.sub) };
    } catch {
      return { status: 401, body: { code: "unauthenticated", message: "bad refresh" } };
    }
  }

  if (pathname === "/api/identity/v1/auth/logout" && method === "POST") {
    return { status: 204 };
  }

  if (!sub) return { status: 401, body: { code: "unauthenticated", message: "sign in" } };
  const person = principalById(sub);
  if (!person) return { status: 401, body: { code: "unauthenticated", message: "unknown principal" } };

  if (pathname === "/api/user/v1/me") {
    return { status: 200, body: { principal_id: person.id, roles: person.roles, student: person.student } };
  }

  if (pathname === "/api/user/v1/permission-catalogue") {
    const verb = (service, resource, name, platform_only = false) => ({
      key: `${service}.${resource}.${name}`,
      service,
      resource,
      verb: name,
      platform_only,
    });
    const entry = (service, resource, platform_only = false) =>
      ["read", "write", "delete"].map((name) => verb(service, resource, name, platform_only));
    return {
      status: 200,
      body: {
        permissions: [
          ...entry("question-bank", "questions"),
          ...entry("assessment", "exams"),
          ...entry("assessment", "exam_versions"),
          ...entry("submission", "attempts"),
          ...entry("user", "students"),
          ...entry("tenant", "departments"),
          ...entry("tenant", "batches"),
          ...entry("tenant", "tenants", true),
          ...entry("user", "role_assignments", true),
          ...entry("user", "permission_grants", true),
        ],
      },
    };
  }

  if (pathname.startsWith("/api/user/v1/role-assignments")) {
    return {
      status: 200,
      body: page([
        {
          id: "0190a0a0-0000-7000-8000-000000000101",
          principal_id: PRINCIPALS.admin.id,
          role_name: "super_admin",
          scope_kind: "platform",
          status: "active",
          root: true,
        },
        {
          id: "0190a0a0-0000-7000-8000-000000000102",
          principal_id: PRINCIPALS.staff.id,
          role_name: "college_admin",
          scope_kind: "college",
          tenant_id: TENANT,
          scope_id: TENANT,
          status: "active",
          root: false,
        },
      ]),
    };
  }

  if (/\/api\/user\/v1\/(staff|tenants\/[^/]+\/staff)\/[^/]+\/permissions$/.test(pathname)) {
    return { status: 200, body: { permissions: [] } };
  }

  const roleList = pathname.match(/^\/api\/user\/v1\/tenants\/[^/]+\/roles$/);
  if (roleList) {
    if (method === "GET") return { status: 200, body: { roles } };
    if (method === "POST") {
      const created = {
        id: randomUUID(),
        guild_kind: "college",
        tenant_id: TENANT,
        name: String(body?.name ?? "Custom role"),
        tier: Number(body?.tier ?? 1),
        position: Number(body?.position ?? 50),
        permissions: Array.isArray(body?.permissions) ? body.permissions.map(String) : [],
        managed: false,
        version: 1,
      };
      roles.push(created);
      return { status: 201, body: created };
    }
  }

  const roleOne = pathname.match(/^\/api\/user\/v1\/tenants\/[^/]+\/roles\/([^/]+)$/);
  if (roleOne) {
    const id = roleOne[1];
    const index = roles.findIndex((entry) => entry.id === id);
    if (index < 0) return { status: 404, body: { code: "not_found", message: "role" } };
    if (method === "PATCH") {
      if (roles[index].managed) return { status: 403, body: { code: "forbidden", message: "managed role" } };
      roles[index] = {
        ...roles[index],
        ...(body?.name ? { name: String(body.name) } : {}),
        ...(body?.position !== undefined ? { position: Number(body.position) } : {}),
        ...(Array.isArray(body?.permissions) ? { permissions: body.permissions.map(String) } : {}),
        version: roles[index].version + 1,
      };
      return { status: 200, body: roles[index] };
    }
    if (method === "DELETE") {
      if (roles[index].managed) return { status: 403, body: { code: "forbidden", message: "managed role" } };
      roles.splice(index, 1);
      return { status: 204 };
    }
  }

  const principalMatch = pathname.match(/^\/api\/identity\/v1\/principals\/([^/]+)$/);
  if (principalMatch && method === "GET") {
    const id = decodeURIComponent(principalMatch[1]);
    if (id !== person.id) return { status: 403, body: { code: "forbidden", message: "forbidden" } };
    return {
      status: 200,
      body: { id: person.id, username: person.username, display_name: person.display_name, email: `${person.username}@dev.local` },
    };
  }

  if (pathname === `/api/tenant/v1/tenants/${TENANT}` || pathname === "/api/tenant/v1/tenants") {
    if (pathname.endsWith("/tenants")) {
      return {
        status: 200,
        body: page([{ id: TENANT, slug: "dev-college", legal_name: "Dev College", display_name: "Dev College", status: "active" }]),
      };
    }
    return {
      status: 200,
      body: { id: TENANT, slug: "dev-college", legal_name: "Dev College", display_name: "Dev College", status: "active" },
    };
  }

  if (pathname.includes("/exams") && method === "GET") {
    return {
      status: 200,
      body: page([
        {
          id: examId,
          tenant_id: TENANT,
          version: 1,
          created_at: opens,
        },
      ]),
    };
  }

  if (pathname.includes("/exam-versions") && method === "GET" && !pathname.includes("/content")) {
    return {
      status: 200,
      body: page([
        {
          id: examVersionId,
          tenant_id: TENANT,
          exam_id: examId,
          version_number: 1,
          title: "Sample Lab Test",
          instructions_markdown: "Solve every question.",
          opens_at: opens,
          closes_at: closes,
          duration_seconds: 5400,
          status: "published",
          content_version: 1,
          proctor_policy_version_id: randomUUID(),
          published_at: opens,
          created_at: opens,
        },
      ]),
    };
  }

  if (pathname.includes("/candidate-assignments")) {
    return {
      status: 200,
      body: page([
        {
          id: assignmentId,
          tenant_id: TENANT,
          exam_id: examId,
          exam_version_id: examVersionId,
          title: "Sample Lab Test",
          instructions_markdown: "Solve every question.",
          duration_seconds: 5400,
          available_from: opens,
          available_until: closes,
          lifecycle_state: "assigned",
        },
        {
          id: "0190a0a0-0000-7000-8000-000000000201",
          tenant_id: TENANT,
          exam_id: examId,
          exam_version_id: examVersionId,
          title: "Upcoming Mock Exam",
          instructions_markdown: "Warm-up paper.",
          duration_seconds: 3600,
          available_from: closes,
          available_until: new Date(now + 14 * 86400_000).toISOString(),
          lifecycle_state: "assigned",
        },
      ]),
    };
  }

  const practiceOne = pathname.match(/^\/api\/question-bank\/v1\/tenants\/[^/]+\/practice\/questions\/([^/]+)$/);
  if (practiceOne && method === "GET") {
    const detail = practiceDetail(practiceOne[1]);
    if (!detail) return { status: 404, body: { code: "not_found", message: "practice problem" } };
    return { status: 200, body: detail };
  }

  if (pathname.match(/^\/api\/question-bank\/v1\/tenants\/[^/]+\/practice\/questions$/) && method === "GET") {
    return { status: 200, body: practiceProblems };
  }

  if (pathname.match(/^\/api\/question-bank\/v1\/tenants\/[^/]+\/practice\/progress$/) && method === "GET") {
    const solved = practiceProblems.filter((problem) => problem.solved).length;
    return {
      status: 200,
      body: {
        solved,
        available: practiceProblems.length,
        by_difficulty: {
          easy: { solved: practiceProblems.filter((p) => p.difficulty === "easy" && p.solved).length, available: practiceProblems.filter((p) => p.difficulty === "easy").length },
          medium: { solved: practiceProblems.filter((p) => p.difficulty === "medium" && p.solved).length, available: practiceProblems.filter((p) => p.difficulty === "medium").length },
          hard: { solved: practiceProblems.filter((p) => p.difficulty === "hard" && p.solved).length, available: practiceProblems.filter((p) => p.difficulty === "hard").length },
        },
        submissions: 12,
        accepted: solved,
        active_days: [0, 1, 2, 3, 5, 6].map((daysAgo) => new Date(now - daysAgo * 86400_000).toISOString().slice(0, 10)),
      },
    };
  }

  const contestBoard = pathname.match(/^\/api\/question-bank\/v1\/tenants\/[^/]+\/contests\/([^/]+)\/leaderboard$/);
  if (contestBoard && method === "GET") {
    return {
      status: 200,
      body: [
        { actor_id: PRINCIPALS.student.id, problems: 3, last_solve: opens },
        { actor_id: "0190a0a0-0000-7000-8000-000000000021", problems: 2, last_solve: opens },
      ],
    };
  }

  if (pathname.match(/^\/api\/question-bank\/v1\/tenants\/[^/]+\/contests$/) && method === "GET") {
    return { status: 200, body: collegeContests };
  }

  if (pathname.match(/^\/api\/question-bank\/v1\/tenants\/[^/]+\/contests\/[^/]+\/register$/) && method === "POST") {
    return { status: 200, body: { ok: true } };
  }

  if (pathname.includes("/community/")) {
    if (pathname.includes("/community/feed")) {
      const kind = query.get("kind");
      const bookmarked = query.get("bookmarked");
      let items = communityFeed;
      if (kind) items = items.filter((item) => item.kind === kind);
      if (bookmarked === "true" || bookmarked === "1") items = items.filter((item) => item.bookmarked);
      return { status: 200, body: page(items) };
    }
    if (pathname.includes("/community/interviews")) return { status: 200, body: page(interviewItems) };
    if (pathname.includes("/community/posts")) return { status: 200, body: page(blogItems) };
    if (pathname.includes("/community/tasks")) return { status: 200, body: page(taskItems) };
    if (pathname.includes("/community/profile-links")) {
      return {
        status: 200,
        body: page([
          { platform: "leetcode", handle: "aria-dev" },
          { platform: "github", handle: "aria-dev" },
        ]),
      };
    }
    return { status: 200, body: page([]) };
  }

  if (pathname.includes("/profiles/") && pathname.includes("/public")) {
    return {
      status: 200,
      body: {
        slug: "aria-dev",
        enabled: true,
        content: {
          name: person.display_name,
          headline: "CSE · Dev College",
          bio: "Demo student profile for UI redesign.",
          college: "Dev College",
          batch: "CSE A",
          skills: ["python", "cpp", "sql"],
          links: [{ platform: "leetcode", handle: "aria-dev" }],
        },
        updated_at: opens,
      },
    };
  }

  if (pathname.includes("/realtime/services") || pathname.endsWith("/realtime/services")) {
    return {
      status: 200,
      body: {
        type: "health",
        checked_at: new Date().toISOString(),
        services: [
          { name: "identity", ready: true, milliseconds: 4, description: "Dev emulator" },
          { name: "user", ready: true, milliseconds: 3, description: "Dev emulator" },
          { name: "tenant", ready: true, milliseconds: 3, description: "Dev emulator" },
          { name: "assessment", ready: true, milliseconds: 5, description: "Dev emulator" },
          { name: "submission", ready: true, milliseconds: 6, description: "Dev emulator" },
        ],
      },
    };
  }

  if (pathname.includes("/proctor-policies")) {
    return { status: 200, body: page([]) };
  }

  if (pathname.includes("/attempts/") && pathname.endsWith("/result") && method === "GET") {
    return {
      status: 200,
      body: {
        released: true,
        released_at: opens,
        score: 18,
        maximum_score: 20,
        items: [
          { exam_item_id: practiceIds.twoSum, position: 1, title: "Two Sum", score: 10, maximum_score: 10, kind: "coding", tests: [{ number: 1, verdict: "accepted" }, { number: 2, verdict: "accepted" }] },
          { exam_item_id: practiceIds.binary, position: 2, title: "Binary Search", score: 8, maximum_score: 10, kind: "coding", tests: [{ number: 1, verdict: "accepted" }, { number: 2, verdict: "wrong_answer" }] },
        ],
      },
    };
  }

  if (pathname.match(/^\/api\/submission\/v1\/tenants\/[^/]+\/attempts$/) && method === "GET") {
    return {
      status: 200,
      body: page([
        {
          id: attemptId,
          tenant_id: TENANT,
          exam_id: examId,
          exam_version_id: examVersionId,
          candidate_assignment_id: assignmentId,
          attempt_number: 1,
          lifecycle_state: "submitted",
          submission_deadline: closes,
          started_at: opens,
          submitted_at: opens,
          completed_at: opens,
          version: 1,
        },
      ]),
    };
  }

  if (pathname.includes("/attempts") || pathname.includes("/questions") || pathname.includes("/students")) {
    return { status: 200, body: page([]) };
  }

  if (pathname.includes("/grading-queue") || pathname.includes("/queue")) {
    return {
      status: 200,
      body: {
        checked_at: new Date().toISOString(),
        evaluations: {
          queued: 0,
          dispatched: 0,
          oldest_waiting_at: null,
          completed_last_hour: 2,
          failed_last_hour: 0,
          median_seconds_last_hour: 1.2,
          p95_seconds_last_hour: 3.4,
        },
        runs: {
          queued: 0,
          dispatched: 0,
          oldest_waiting_at: null,
          completed_last_hour: 5,
          failed_last_hour: 0,
          median_seconds_last_hour: 0.4,
          p95_seconds_last_hour: 1.1,
        },
      },
    };
  }

  if (pathname.includes("/monitor")) {
    const candidate = (attempt, submitted, flags) => ({
      candidate_id: randomUUID(),
      attempt_id: attempt,
      lifecycle_state: attempt ? (submitted ? "submitted" : "active") : null,
      started_at: attempt ? opens : null,
      submission_deadline: closes,
      submitted_at: submitted,
      items_answered: attempt ? 2 : 0,
      score: null,
      maximum_score: null,
      flags,
    });
    return {
      status: 200,
      body: {
        exam_version_id: examVersionId,
        require_fullscreen: true,
        block_external_paste: true,
        webcam_required: false,
        results_released_at: null,
        announcements: [],
        candidates: [
          candidate(randomUUID(), null, 0),
          candidate(randomUUID(), null, 1),
          candidate(randomUUID(), new Date().toISOString(), 0),
          candidate(null, null, 0),
          candidate(null, null, 0),
        ],
      },
    };
  }

  if (pathname.includes("/audit") || pathname.includes("/practice/progress")) {
    if (pathname.includes("/practice/progress")) {
      return {
        status: 200,
        body: {
          solved: 3,
          available: 20,
          by_difficulty: {
            easy: { solved: 2, available: 8 },
            medium: { solved: 1, available: 8 },
            hard: { solved: 0, available: 4 },
          },
          active_days: [new Date().toISOString().slice(0, 10)],
        },
      };
    }
    return { status: 200, body: page([]) };
  }

  const departmentList = pathname.match(/^\/api\/tenant\/v1\/tenants\/[^/]+\/departments$/);
  if (departmentList) {
    if (method === "GET") return { status: 200, body: page(departments) };
    if (method === "POST") {
      const created = {
        id: randomUUID(),
        tenant_id: TENANT,
        code: String(body?.code ?? "NEW").toUpperCase(),
        name: String(body?.name ?? "New department"),
        department_type: "college",
        status: "active",
      };
      departments.push(created);
      return { status: 200, body: created };
    }
  }

  const departmentOne = pathname.match(/^\/api\/tenant\/v1\/tenants\/[^/]+\/departments\/([^/]+)$/);
  if (departmentOne) {
    const id = departmentOne[1];
    const index = departments.findIndex((entry) => entry.id === id);
    if (index < 0) return { status: 404, body: { code: "not_found", message: "department" } };
    if (method === "GET") return { status: 200, body: departments[index] };
    if (method === "PATCH") {
      departments[index] = {
        ...departments[index],
        ...(body?.name ? { name: String(body.name) } : {}),
        ...(body?.code ? { code: String(body.code).toUpperCase() } : {}),
      };
      return { status: 200, body: departments[index] };
    }
    if (method === "DELETE") {
      if (batches.some((batch) => batch.department_id === id)) {
        return { status: 409, body: { code: "failed_precondition", message: "delete batches first" } };
      }
      departments.splice(index, 1);
      return { status: 204 };
    }
  }

  const batchList = pathname.match(/^\/api\/tenant\/v1\/tenants\/[^/]+\/batches$/);
  if (batchList) {
    if (method === "GET") return { status: 200, body: page(batches) };
    if (method === "POST") {
      const created = {
        id: randomUUID(),
        tenant_id: TENANT,
        department_id: String(body?.department_id ?? ""),
        code: String(body?.code ?? "NEW").toUpperCase(),
        name: String(body?.name ?? "New batch"),
        academic_year: String(body?.academic_year ?? "2026-2027"),
        status: "active",
      };
      batches.push(created);
      return { status: 200, body: created };
    }
  }

  const batchOne = pathname.match(/^\/api\/tenant\/v1\/tenants\/[^/]+\/batches\/([^/]+)$/);
  if (batchOne) {
    const id = batchOne[1];
    const index = batches.findIndex((entry) => entry.id === id);
    if (index < 0) return { status: 404, body: { code: "not_found", message: "batch" } };
    if (method === "GET") return { status: 200, body: batches[index] };
    if (method === "PATCH") {
      batches[index] = {
        ...batches[index],
        ...(body?.name ? { name: String(body.name) } : {}),
        ...(body?.code ? { code: String(body.code).toUpperCase() } : {}),
        ...(body?.academic_year ? { academic_year: String(body.academic_year) } : {}),
      };
      return { status: 200, body: batches[index] };
    }
    if (method === "DELETE") {
      batches.splice(index, 1);
      return { status: 204 };
    }
  }

  if (method === "GET") return { status: 200, body: page([]) };
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    return { status: 200, body: { id: randomUUID(), ok: true } };
  }
  return { status: 204 };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204);
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { code: "invalid_argument", message: "bad json" });
  }
  const sub = subjectFromAuth(req);
  const result = handle(url.pathname.replace(/\/+$/, "") || "/", req.method ?? "GET", body, sub, url.searchParams);
  if (result.status === 204) return json(res, 204);
  return json(res, result.status, result.body);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`dev-gateway on http://127.0.0.1:${PORT}`);
  console.log("demo logins: staff/staff, student/student, admin/admin");
});
