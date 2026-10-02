"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { generatePassword, hashPassword } from "@/lib/password";

export interface Credential {
  username: string;
  name: string;
  batch: string | null;
  password: string;
}

export interface ImportResult {
  created: Credential[];
  skipped: string[];
  errors: string[];
}

const USERNAME = /^[A-Za-z0-9._@-]{1,64}$/;

const studentRow = z.object({
  username: z.string().trim().regex(USERNAME, "username may use letters, digits, . _ @ - (max 64)"),
  name: z.string().trim().min(1, "name is required").max(200),
  batch: z.string().trim().min(1, "batch is required").max(64),
});

// Hash in small parallel groups: scrypt runs on libuv's thread pool.
async function withPasswords<T extends { username: string }>(rows: T[]) {
  const out: Array<T & { password: string; hash: string }> = [];
  for (let index = 0; index < rows.length; index += 8) {
    const group = rows.slice(index, index + 8);
    out.push(
      ...(await Promise.all(
        group.map(async (row) => {
          const password = generatePassword();
          return { ...row, password, hash: await hashPassword(password) };
        }),
      )),
    );
  }
  return out;
}

export async function importStudents(rows: Array<Record<string, string>>): Promise<ImportResult> {
  await requireUser("admin");
  if (rows.length > 5000) return { created: [], skipped: [], errors: ["Upload at most 5000 students at a time."] };

  const errors: string[] = [];
  const valid: Array<z.infer<typeof studentRow>> = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const parsed = studentRow.safeParse(row);
    if (!parsed.success) {
      errors.push(`Row ${index + 2}: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`);
      return;
    }
    const key = parsed.data.username.toLowerCase();
    if (seen.has(key)) {
      errors.push(`Row ${index + 2}: duplicate username ${parsed.data.username} in file`);
      return;
    }
    seen.add(key);
    valid.push(parsed.data);
  });
  if (errors.length > 0) return { created: [], skipped: [], errors };

  const existing = new Set(
    (await sql<{ username: string }[]>`
      SELECT lower(username) AS username FROM users WHERE lower(username) = ANY(${valid.map((row) => row.username.toLowerCase())})`).map(
      (row) => row.username,
    ),
  );
  const fresh = valid.filter((row) => !existing.has(row.username.toLowerCase()));
  const hashed = await withPasswords(fresh);
  if (hashed.length > 0) {
    await sql`
      INSERT INTO users ${sql(
        hashed.map((row) => ({ username: row.username, name: row.name, batch: row.batch, role: "student", password_hash: row.hash })),
      )}
      ON CONFLICT (username) DO NOTHING`;
  }
  revalidatePath("/admin");
  return {
    created: hashed.map(({ username, name, batch, password }) => ({ username, name, batch, password })),
    skipped: valid.filter((row) => existing.has(row.username.toLowerCase())).map((row) => row.username),
    errors: [],
  };
}

export async function createStaff(_: unknown, form: FormData): Promise<{ error?: string; credential?: Credential }> {
  await requireUser("admin");
  const parsed = z
    .object({
      username: z.string().trim().regex(USERNAME, "Username may use letters, digits, . _ @ -"),
      name: z.string().trim().min(1, "Name is required").max(200),
      role: z.enum(["faculty", "admin"]),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const password = generatePassword(12);
  const rows = await sql`
    INSERT INTO users (username, name, role, password_hash)
    VALUES (${parsed.data.username}, ${parsed.data.name}, ${parsed.data.role}, ${await hashPassword(password)})
    ON CONFLICT (username) DO NOTHING
    RETURNING id`;
  if (rows.length === 0) return { error: "That username is already taken." };
  revalidatePath("/admin");
  return { credential: { username: parsed.data.username, name: parsed.data.name, batch: null, password } };
}

export async function resetPassword(_: unknown, form: FormData): Promise<{ error?: string; credential?: Credential }> {
  await requireUser("admin");
  const username = String(form.get("username") ?? "").trim();
  const password = generatePassword();
  const [user] = await sql<{ id: string; name: string; batch: string | null }[]>`
    UPDATE users SET password_hash = ${await hashPassword(password)}
    WHERE lower(username) = ${username.toLowerCase()}
    RETURNING id, name, batch`;
  if (!user) return { error: "No user with that username." };
  await sql`DELETE FROM sessions WHERE user_id = ${user.id}`;
  return { credential: { username, name: user.name, batch: user.batch, password } };
}

export async function setDisabled(userId: string, disabled: boolean): Promise<void> {
  const admin = await requireUser("admin");
  if (admin.id === userId) return;
  await sql`UPDATE users SET disabled = ${disabled} WHERE id = ${userId}`;
  if (disabled) await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
  revalidatePath("/admin");
}
