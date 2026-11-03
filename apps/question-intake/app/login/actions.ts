"use server";

import { redirect } from "next/navigation";
import { clearSession, signIn } from "@/lib/session";

export type LoginState = { error: string | null; identifier: string };

export async function loginAction(_previous: LoginState, form: FormData): Promise<LoginState> {
  const identifier = String(form.get("identifier") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!identifier || !password) return { error: "Enter your username and password.", identifier };
  const error = await signIn(identifier, password);
  if (error) return { error, identifier };
  redirect("/");
}

export async function signOutAction() {
  await clearSession();
  redirect("/login");
}
