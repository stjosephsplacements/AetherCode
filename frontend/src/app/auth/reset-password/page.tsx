import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, ResetUnavailable } from "@/components/site/auth-card";
import { passwordResetByEmail } from "@/lib/auth-paths";
import { ResetForm } from "./form";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthCard title="Choose a new password" lead="// this link works once. Signing in elsewhere is ended when you save.">
      {!passwordResetByEmail() ? (
        <ResetUnavailable />
      ) : token ? (
        <ResetForm token={token} />
      ) : (
        <p role="alert" className="rounded-xl border border-danger bg-danger-soft px-3.5 py-2.5 font-mono text-[13.5px] text-danger">
          [!] This link is incomplete. Open the link from your email again, or{" "}
          <Link href="/auth/forgot-password" className="underline">ask for a new one</Link>.
        </p>
      )}
    </AuthCard>
  );
}
