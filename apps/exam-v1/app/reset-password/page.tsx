import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/auth-layout";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) redirect("/forgot-password");

  return (
    <AuthLayout
      title="Set new password"
      subtitle="Choose a new password for your account."
    >
      <ResetPasswordForm token={token} />
    </AuthLayout>
  );
}
