import { AuthLayout } from "@/components/auth-layout";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthLayout
      title="Reset password"
      subtitle="Enter your username and email address. We'll send a reset link to your email."
    >
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
