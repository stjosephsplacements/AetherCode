import { LoginForm } from "./login-form";
import { Logo } from "@/components/ui";

export default function LoginPage() {
  return (
    <main className="relative isolate grid min-h-dvh place-items-center px-4 py-10">
      <div className="hero-glow absolute inset-0 -z-10 opacity-70" />
      <div className="w-full max-w-sm">
        <Logo className="mb-8" />
        <h1 className="font-display text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mb-8 mt-2 text-sm text-muted">Use the username and password given by your department.</p>
        <LoginForm />
      </div>
    </main>
  );
}
