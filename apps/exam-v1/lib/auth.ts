import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "./db.ts";

export type Role = "admin" | "faculty" | "student";

export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
  batch: string | null;
}

const COOKIE = "sid";
const SESSION_HOURS = 12;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function startSession(user: Pick<User, "id" | "role">): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  // A student may only be signed in on one machine at a time.
  if (user.role === "student") await sql`DELETE FROM sessions WHERE user_id = ${user.id}`;
  await sql`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${hashToken(token)}, ${user.id}, now() + make_interval(hours => ${SESSION_HOURS}))`;
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE !== "false",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) await sql`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`;
  store.delete(COOKIE);
}

export const currentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const rows = await sql<User[]>`
    SELECT u.id, u.username, u.name, u.role, u.batch
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > now() AND NOT u.disabled`;
  return rows[0] ?? null;
});

export async function requireUser(...roles: Role[]): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (roles.length > 0 && !roles.includes(user.role)) redirect(homeFor(user.role));
  return user;
}

export function homeFor(role: Role): string {
  if (role === "admin") return "/admin";
  if (role === "faculty") return "/faculty";
  return "/student";
}
