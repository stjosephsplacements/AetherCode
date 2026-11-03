import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { gatewayUrl, secureCookies } from "./env.ts";

const ACCESS = "qi_access";
const REFRESH = "qi_refresh";
const VIEWER = "qi_viewer";

type TokenPair = { access_token: string; access_token_expires_at: string; refresh_token: string; refresh_token_expires_at: string };

/** Who is signed in. Staff only: students never reach this app. */
export type Viewer = { principalId: string; name: string; roles: string[] };

const STAFF = new Set(["super_admin", "college_admin", "department_user", "placement_user", "mentor"]);

async function call<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<{ status: number; data: T | null }> {
  const response = await fetch(`${gatewayUrl()}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(init.method && init.method !== "GET" ? { "idempotency-key": crypto.randomUUID() } : {}),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  return { status: response.status, data: (await response.json().catch(() => null)) as T | null };
}

function subject(token: string): string {
  try {
    return (JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string }).sub ?? "";
  } catch {
    return "";
  }
}

function expiry(token: string): number {
  try {
    return ((JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: number }).exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

async function loadViewer(token: string): Promise<Viewer | null> {
  const me = await call<{ principal_id: string; roles: { role_name: string }[] }>("/user/v1/me", { token });
  if (me.status !== 200 || !me.data) return null;
  const roles = [...new Set(me.data.roles.map((role) => role.role_name))];
  if (!roles.some((role) => STAFF.has(role))) return null;
  const principal = await call<{ display_name?: string; username?: string; email?: string }>(`/identity/v1/principals/${subject(token)}`, { token });
  return { principalId: me.data.principal_id, name: principal.data?.display_name || principal.data?.username || principal.data?.email || "Staff", roles };
}

async function store(pair: TokenPair, viewer: Viewer) {
  const jar = await cookies();
  const base = { httpOnly: true, secure: secureCookies(), sameSite: "strict" as const, path: "/" };
  jar.set({ ...base, name: ACCESS, value: pair.access_token, expires: new Date(pair.access_token_expires_at) });
  jar.set({ ...base, name: REFRESH, value: pair.refresh_token, expires: new Date(pair.refresh_token_expires_at) });
  jar.set({ ...base, name: VIEWER, value: JSON.stringify(viewer), expires: new Date(pair.refresh_token_expires_at) });
}

export async function clearSession() {
  const jar = await cookies();
  for (const name of [ACCESS, REFRESH, VIEWER]) jar.delete(name);
}

/** Signs in through the platform's identity service. Returns an error message, or null when signed in. */
export async function signIn(identifier: string, password: string): Promise<string | null> {
  const login = await call<TokenPair>("/identity/v1/auth/login", { method: "POST", body: { identifier, password } });
  if (login.status === 401) return "That username or password is wrong.";
  if (login.status === 429) return "Too many sign-in attempts. Wait a minute and try again.";
  if (login.status !== 200 || !login.data?.access_token) return "The platform could not sign you in. Try again in a moment.";
  const viewer = await loadViewer(login.data.access_token);
  if (!viewer) return "This tool is for staff accounts.";
  await store(login.data, viewer);
  return null;
}

/** The signed-in staff member. The proxy has already rotated an expiring token. */
export async function requireViewer(): Promise<{ viewer: Viewer; token: string }> {
  const jar = await cookies();
  const raw = jar.get(VIEWER)?.value;
  const access = jar.get(ACCESS)?.value;
  if (!raw || !access) redirect("/login");
  return { viewer: JSON.parse(raw) as Viewer, token: access };
}
