import type { Metadata } from "next";
import { AuthCard } from "@/components/site/auth-card";
import { ForgotForm } from "./form";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Forgot your password?" lead="// we email a one-time link to the address on your account.">
      <ForgotForm />
    </AuthCard>
  );
}
