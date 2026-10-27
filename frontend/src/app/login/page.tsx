import type { Metadata } from "next";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { LoginForm } from "./login-form";
import { TestRunner } from "./test-runner";

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
    <main className="relative isolate grid min-h-dvh overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* Ambient light: green from the left, cyan behind the runner. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-40 -top-56 size-[720px] rounded-full bg-[radial-gradient(closest-side,var(--glow),transparent)]" />
        <div className="absolute -bottom-64 right-[-10%] size-[820px] rounded-full bg-[radial-gradient(closest-side,var(--glow-2),transparent)]" />
      </div>

      <section className="flex flex-col px-6 py-8 sm:px-12 lg:px-16 xl:px-24">
        <div className="flex items-center gap-2.5">
          <Image src="/4.png" alt="" width={28} height={28} priority className="logo-light object-contain" />
          <Image src="/3.png" alt="" width={28} height={28} priority className="logo-dark object-contain" />
          <span className="text-[15px] font-semibold tracking-tight text-ink">AetherCode</span>
        </div>

        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-12 lg:mx-0">
          <h1 className="display text-[2.75rem] text-ink sm:text-[3.5rem]">Skills over pedigree.</h1>
          <p className="mt-4 max-w-[36ch] text-[15px] leading-relaxed text-ink-muted">
            Sign in with your roll number to see your exams, practice problems and results.
          </p>

          <div className="mt-10">
            {ssoError && (
              <p role="alert" className="mb-6 rounded-[var(--radius-control)] bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
                {ssoError}
              </p>
            )}
            {ssoEnabled && (
              <>
                <Button asChild variant="secondary" size="lg" className="w-full">
                  <a href={`/auth/sso${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in with your college account</a>
                </Button>
                <div className="my-6 flex items-center gap-3 text-xs text-ink-subtle" aria-hidden>
                  <span className="h-px flex-1 bg-line" />
                  or use your AetherCode password
                  <span className="h-px flex-1 bg-line" />
                </div>
              </>
            )}
            <LoginForm next={next ?? ""} />
          </div>
        </div>

        <p className="text-xs text-ink-subtle">Can&apos;t sign in? Your exam administrator can reset your password.</p>
      </section>

      <section aria-label="Preview" className="relative hidden items-center justify-center px-12 py-16 lg:flex">
        <div className="w-full max-w-[540px] animate-enter">
          <TestRunner />
        </div>
      </section>
    </main>
  );
}
