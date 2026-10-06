import { redirect } from "next/navigation";
import { currentUser, homeFor } from "@/lib/auth";
import { ChangePasswordForm } from "./change-password-form";
import { Logo } from "@/components/ui";

export default async function ChangePasswordPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.mustChangePassword) redirect(homeFor(user.role));

  return (
    <main className="relative isolate grid min-h-dvh place-items-center px-4 py-10">
      <div className="hero-glow absolute inset-0 -z-10 opacity-70" />
      <div className="w-full max-w-sm">
        <Logo className="mb-8" />
        <h1 className="font-display text-3xl font-semibold tracking-tight">Set your password</h1>
        <p className="mb-8 mt-2 text-sm text-muted">
          You&apos;re using a default password. Choose a new one to continue.
        </p>
        <ChangePasswordForm />
      </div>
    </main>
  );
}
