import type { Metadata } from "next";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { LoginForm } from "./login-form";

// Why a single sign-on did not finish (ADR-0042).
const SSO_ERRORS: Record<string, string> = {
  unavailable: "The institutional sign-in is unreachable right now. Use your AetherCode password.",
  cancelled: "Sign-in was cancelled.",
  expired: "That sign-in took too long or was opened in another browser. Try again.",
  no_account: "Your institutional account has no AetherCode account yet. Ask your faculty to add you.",
  busy: "Too many sign-in attempts. Wait a minute and try again.",
  failed: "The sign-in could not be completed. Try again, or use your AetherCode password.",
};

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; sso?: string }> }) {
  const { next, sso } = await searchParams;
  const ssoEnabled = process.env.AETHERCODE_SSO === "on";
  const ssoError = sso ? (SSO_ERRORS[sso] ?? SSO_ERRORS.failed) : null;
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-5 py-12 cinematic-glow">
      {/* Background ambient lighting */}
      <div className="absolute inset-0 pointer-events-none -z-10 overflow-hidden">
        <div className="absolute -top-[25%] left-1/2 -translate-x-1/2 w-[600px] h-[500px] rounded-full bg-[radial-gradient(ellipse_at_center,_var(--color-hr-green)_0%,_transparent_70%)] opacity-[0.07] blur-3xl" />
        <div className="absolute top-[60%] -left-[10%] w-[400px] h-[400px] rounded-full bg-[radial-gradient(ellipse_at_center,_var(--color-hr-cyan)_0%,_transparent_70%)] opacity-[0.05] blur-3xl" />
      </div>

      <div className="w-full max-w-[460px] animate-enter rounded-[var(--radius-surface)] border border-line bg-surface/90 p-8 shadow-[var(--shadow-overlay)] backdrop-blur-xl sm:p-10">
        <div className="flex flex-col items-center text-center">
          <div className="relative mb-6">
            <Image src="/4.png" alt="AetherCode" width={48} height={48} priority className="logo-light object-contain" />
            <Image src="/3.png" alt="AetherCode" width={48} height={48} priority className="logo-dark object-contain" />
          </div>

          <span className="eyebrow text-brand font-semibold">SKILLS OVER PEDIGREE</span>
          <h1 className="display mt-2 text-[2rem] text-ink sm:text-[2.25rem]">Sign in to AetherCode</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">
            Code, assess, and benchmark candidate excellence.
          </p>
        </div>

        <div className="mt-8">
          {ssoError && (
            <p role="alert" className="mb-6 rounded-[var(--radius-control)] bg-danger-soft px-3 py-2 text-sm text-danger">
              {ssoError}
            </p>
          )}
          {ssoEnabled && (
            <>
              <Button asChild size="lg" className="w-full font-medium shadow-sm">
                <a href={`/auth/sso${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in with your institutional account</a>
              </Button>
              <div className="mt-6 flex items-center gap-3 text-xs text-ink-subtle" aria-hidden>
                <span className="h-px flex-1 bg-line" />
                or with credentials
                <span className="h-px flex-1 bg-line" />
              </div>
            </>
          )}
          <LoginForm next={next ?? ""} />
        </div>
      </div>

      <p className="mt-8 text-center text-xs text-ink-subtle">
        Trouble signing in? Contact your institution&apos;s exam administrator.
      </p>
    </main>
  );
}
