"use server";

import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { homeFor, startSession, type Role } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";

// Verified when the username does not exist, so both paths cost one scrypt.
const DUMMY_HASH = hashPassword("not-a-real-password");

const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILURES = 5;
const LOCK_MS = 60_000;

export async function login(_: string | null, form: FormData): Promise<string | null> {
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!username || !password) return "Enter your username and password.";

  const key = username.toLowerCase();
  const lock = failures.get(key);
  if (lock && lock.count >= MAX_FAILURES && lock.until > Date.now()) return "Too many attempts. Wait a minute and try again.";

  const [user] = await sql<{ id: string; role: Role; password_hash: string; disabled: boolean; must_change_password: boolean }[]>`
    SELECT id, role, password_hash, disabled, must_change_password FROM users WHERE lower(username) = ${key}`;
  const valid = await verifyPassword(password, user ? user.password_hash : await DUMMY_HASH);
  if (!user || user.disabled || !valid) {
    const count = (lock && lock.until > Date.now() ? lock.count : 0) + 1;
    failures.set(key, { count, until: Date.now() + LOCK_MS });
    return "Incorrect username or password.";
  }
  failures.delete(key);
  await startSession(user);
  if (user.must_change_password) redirect("/change-password");
  redirect(homeFor(user.role));
}
