"use server";

import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { currentUser, homeFor } from "@/lib/auth";
import { hashPassword } from "@/lib/password";

export async function changePassword(_: string | null, form: FormData): Promise<string | null> {
  const user = await currentUser();
  if (!user) redirect("/login");

  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password !== confirm) return "Passwords do not match.";
  if (password === "aether@#1290") return "Please choose a different password from the default.";

  const hash = await hashPassword(password);
  await sql`
    UPDATE users SET password_hash = ${hash}, must_change_password = false
    WHERE id = ${user.id}`;

  redirect(homeFor(user.role));
}
