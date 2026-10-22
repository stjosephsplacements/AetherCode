import type { Metadata } from "next";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { LoginForm } from "./login-form";

// Why a single sign-on did not finish (ADR-0042).
const SSO_ERRORS: Record<string, string> = {
  unavailable: "The St. Joseph's sign-in is unreachable right now. Use your AetherCode password.",
  cancelled: "Sign-in was cancelled.",
  expired: "That sign-in took too long or was opened in another browser. Try again.",
  no_account: "Your St. Joseph's account has no AetherCode account yet. Ask your faculty to add you.",
  busy: "Too many sign-in attempts. Wait a minute and try again.",
  failed: "The sign-in could not be completed. Try again, or use your AetherCode password.",
};

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; sso?: string }> }) {
  const { next, sso } = await searchParams;
  const ssoEnabled = process.env.AETHERCODE_SSO === "on";
  const ssoError = sso ? (SSO_ERRORS[sso] ?? SSO_ERRORS.failed) : null;
  return (
    <main className="flex min-h-dvh flex-col items-center px-5 pt-[14vh] pb-10">
      <div className="w-full max-w-[520px] animate-enter">
        <Image src="/logo.png" alt="AetherCode" width={44} height={44} priority className="mx-auto" />
        <h1 className="display mt-7 text-center text-[2.1rem] text-ink sm:text-[2.5rem]">Sign in to AetherCode</h1>
        <p className="mx-auto mt-3 max-w-[34ch] text-center text-[15px] leading-relaxed text-ink-muted">
          Use your roll number or username and the password from your college.
        </p>
        <div className="mx-auto max-w-[360px]">
          {ssoError && (
            <p role="alert" className="mt-6 rounded-[var(--radius-control)] bg-danger-soft px-3 py-2 text-sm text-danger">
              {ssoError}
            </p>
          )}
          {ssoEnabled && (
            <>
              <Button asChild size="lg" className="mt-8 w-full">
                <a href={`/auth/sso${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in with your St. Joseph&apos;s account</a>
              </Button>
              <div className="mt-6 flex items-center gap-3 text-xs text-ink-subtle" aria-hidden>
                <span className="h-px flex-1 bg-line" />
                or with your AetherCode password
                <span className="h-px flex-1 bg-line" />
              </div>
            </>
          )}
          <LoginForm next={next ?? ""} />
        </div>
      </div>
      <p className="mt-auto pt-16 text-center text-xs text-ink-subtle">Trouble signing in? Ask your faculty or invigilator to reset your password.</p>
    </main>
  );
}
