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
    display_name: "Dev Student",
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
const deptCse = "0190a0a0-0000-7000-8000-000000000301";
const deptEce = "0190a0a0-0000-7000-8000-000000000302";
const batchCseA = "0190a0a0-0000-7000-8000-000000000401";
const batchCseB = "0190a0a0-0000-7000-8000-000000000402";
const batchEceA = "0190a0a0-0000-7000-8000-000000000403";

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

function handle(pathname, method, body, sub) {
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
          id: "0190a0a0-0000-7000-8000-000000000200",
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
      ]),
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
  const result = handle(url.pathname.replace(/\/+$/, "") || "/", req.method ?? "GET", body, sub);
  if (result.status === 204) return json(res, 204);
  return json(res, result.status, result.body);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`dev-gateway on http://127.0.0.1:${PORT}`);
  console.log("demo logins: staff/staff, student/student, admin/admin");
});
