import type { Metadata } from "next";
import { AuthCard, ResetUnavailable } from "@/components/site/auth-card";
import { passwordResetByEmail } from "@/lib/auth-paths";
import { ForgotForm } from "./form";

export const metadata: Metadata = { title: "Forgot password", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Forgot your password?" lead="// we email a one-time link to the address on your account.">
      {passwordResetByEmail() ? <ForgotForm /> : <ResetUnavailable />}
    </AuthCard>
  );
}
