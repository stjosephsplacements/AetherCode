import type { Metadata } from "next";
import Link from "next/link";
import { AsciiField } from "@/components/site/ascii-field";
import { WORDMARK } from "@/components/site/wordmark";
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
    <main className="ascii relative grid min-h-dvh place-items-center px-4 py-10">
      <AsciiField />
      <div className="w-full max-w-[480px] border border-ink bg-surface shadow-[6px_6px_0_var(--ink)]">
        <div className="flex items-center justify-between border-b border-ink font-mono text-[13px]">
          <h1 className="px-4 py-2.5 text-ink">[ sign in ]</h1>
          <Link href="/" className="border-l border-ink px-4 py-2.5 text-ink-muted transition-colors hover:bg-brand hover:text-brand-ink">
            [&lt;- home]
          </Link>
        </div>

        <div className="px-6 py-8 sm:px-8">
          <pre aria-hidden className="overflow-hidden text-[clamp(5.5px,1.6vw,7.5px)] leading-[1.15] text-brand">
            {WORDMARK}
          </pre>
          <p className="heading mt-5 text-[1.7rem] leading-[1.25] text-ink">
            <span className="marker">Let your code do the talking.</span>
          </p>
          <p className="mt-3 font-mono text-[12.5px] leading-relaxed text-ink-muted">
            {"// sign in with your roll number to see your exams, practice and results."}
          </p>

          <div className="mt-8">
            {ssoError && (
              <p role="alert" className="mb-6 border border-danger bg-danger-soft px-3.5 py-2.5 font-mono text-[13px] text-danger">
                [!] {ssoError}
              </p>
            )}
            {ssoEnabled && (
              <>
                <a
                  href={`/auth/sso${next ? `?next=${encodeURIComponent(next)}` : ""}`}
                  className="block w-full border border-ink bg-surface py-3 text-center font-mono text-[14px] text-ink shadow-[4px_4px_0_var(--ink)] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5"
                >
                  [ sign in with your college account ]
                </a>
                <p className="my-6 text-center font-mono text-[12px] text-ink-subtle" aria-hidden>
                  ---- or use your AetherCode password ----
                </p>
              </>
            )}
            <LoginForm next={next ?? ""} />
          </div>
        </div>

        <p className="border-t border-ink px-6 py-3 font-mono text-[12px] text-ink-subtle sm:px-8">
          [?] can&apos;t sign in? your exam administrator can reset your password.
        </p>
      </div>
    </main>
  );
}
