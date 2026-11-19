import type { Metadata } from "next";
import { AuthCard, ResetUnavailable } from "@/components/site/auth-card";
import { passwordResetByEmail } from "@/lib/auth-paths";
import { ForgotForm } from "./form";

export const metadata: Metadata = { title: "Forgot password", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Forgot your password?" lead={passwordResetByEmail() ? "// we email a one-time link to the address on your account." : "// reset by email is not set up here."}>
      {passwordResetByEmail() ? <ForgotForm /> : <ResetUnavailable />}
    </AuthCard>
  );
}
