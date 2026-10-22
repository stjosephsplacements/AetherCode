import { redirect } from "next/navigation";
import { currentUser, homeFor } from "@/lib/auth";
import { AuthLayout } from "@/components/auth-layout";
import { ChangePasswordForm } from "./change-password-form";

export default async function ChangePasswordPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.mustChangePassword) redirect(homeFor(user.role));

  return (
    <AuthLayout
      title="Set your password"
      subtitle="You're using a default password. Choose a new one to continue."
    >
      <ChangePasswordForm />
    </AuthLayout>
  );
}
