import { AuthLayout } from "@/components/auth-layout";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <AuthLayout
      title="Sign in"
      subtitle="Use the username and password given by your department."
    >
      <LoginForm />
    </AuthLayout>
  );
}
