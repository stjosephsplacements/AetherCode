import type { Metadata } from "next";
import Link from "next/link";
import { AsciiTorus } from "@/components/site/ascii-torus";
import { WORDMARK } from "@/components/site/wordmark";
import { LoginForm } from "./login-form";
import { Transcript } from "./transcript";

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
    <main className="ascii grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <section className="flex flex-col px-6 py-8 sm:px-12 lg:px-16 xl:px-24">
        <Link href="/" className="w-fit text-[14px] text-ink-muted transition-colors hover:text-ink">
          [&lt;- home]
        </Link>

        <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center py-12 lg:mx-0">
          <h1 className="sr-only">Sign in to AetherCode</h1>
          <pre aria-hidden className="overflow-hidden text-[clamp(6px,1.55vw,9.5px)] leading-[1.15] text-brand lg:text-[clamp(7px,0.95vw,12px)]">
            {WORDMARK}
          </pre>
          <p className="heading mt-6 text-[1.6rem] leading-[1.3] text-ink sm:text-[2rem]">
            <span className="marker">Let your code do the talking.</span>
          </p>
          <p className="mt-4 text-[13.5px] leading-relaxed text-ink-muted">
            {"// sign in with your roll number to see your exams, practice and results."}
          </p>

          <div className="mt-10">
            {ssoError && (
              <p role="alert" className="mb-6 border border-danger bg-danger-soft px-3.5 py-2.5 text-[13.5px] text-danger">
                [!] {ssoError}
              </p>
            )}
            {ssoEnabled && (
              <>
                <a
                  href={`/auth/sso${next ? `?next=${encodeURIComponent(next)}` : ""}`}
                  className="block w-full border border-ink bg-surface py-3 text-center text-[14px] text-ink shadow-[4px_4px_0_var(--ink)] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5"
                >
                  [ sign in with your college account ]
                </a>
                <p className="my-6 text-center text-[12.5px] text-ink-subtle" aria-hidden>
                  ---- or use your AetherCode password ----
                </p>
              </>
            )}
            <LoginForm next={next ?? ""} />
          </div>
        </div>

        <p className="text-[12.5px] text-ink-subtle">[?] can&apos;t sign in? your exam administrator can reset your password.</p>
      </section>

      {/* The arena: always night, whatever the theme. */}
      <section aria-label="Preview" className="relative m-3 hidden max-h-[calc(100dvh-1.5rem)] overflow-hidden bg-[#050505] text-[#f2f2f2] lg:flex lg:flex-col">
        <AsciiTorus className="ascii-art pointer-events-none absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 select-none text-white/30 [--columns:100]" />
        <div className="relative mt-auto p-10">
          <div className="max-w-[520px] border border-white/20 bg-[#050505]/85 p-6 backdrop-blur-sm">
            <p className="mb-4 text-[12.5px] text-[#8a8a8a]">[ exam day ]</p>
            <Transcript />
          </div>
        </div>
      </section>
    </main>
  );
}
