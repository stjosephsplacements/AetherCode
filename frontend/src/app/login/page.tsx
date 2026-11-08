import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AsciiField } from "@/components/site/ascii-field";
import { LiquidGlass } from "@/components/site/liquid-glass";
import { LoginForm } from "./login-form";

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
    <main className="ascii relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <AsciiField />

      {/* Gradient mesh — vivid aurora that glass refracts */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="login-orb absolute -left-[20%] -top-[10%] h-[70%] w-[60%] rounded-full bg-[radial-gradient(closest-side,var(--hero-aurora-1),transparent)] opacity-50" />
        <div className="login-orb absolute -bottom-[15%] -right-[15%] h-[65%] w-[55%] rounded-full bg-[radial-gradient(closest-side,var(--glow-2),transparent)] opacity-40 [animation-delay:-7s]" />
        <div className="login-orb absolute bottom-[10%] left-[20%] h-[45%] w-[40%] rounded-full bg-[radial-gradient(closest-side,var(--hero-aurora-1),transparent)] opacity-25 [animation-delay:-14s]" />
      </div>

      {/* Glow ring behind the card */}
      <div aria-hidden className="pointer-events-none absolute h-[560px] w-[520px] rounded-[40px] bg-brand/10 blur-[80px]" />

      <LiquidGlass
        strong
        className="relative w-full max-w-[460px] overflow-hidden rounded-[32px] shadow-[var(--shadow-overlay)]"
      >
        {/* Top bar with logo and home link */}
        <div className="flex items-center justify-between px-7 pt-7 sm:px-9 sm:pt-9">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <Image src="/4.png" alt="" width={22} height={22} priority className="logo-light object-contain" />
            <Image src="/3.png" alt="" width={22} height={22} priority className="logo-dark object-contain" />
            <span className="font-mono text-[15px] font-semibold tracking-tight text-ink">AetherCode</span>
          </Link>
          <Link href="/" className="rounded-full border border-line px-3 py-1 font-mono text-[12px] text-ink-muted transition-colors hover:bg-hover hover:text-ink">
            &larr; Home
          </Link>
        </div>

        <div className="px-7 pb-9 pt-8 sm:px-9">
          <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-ink">Welcome back</h1>
          <p className="mt-1.5 font-mono text-[13px] leading-relaxed text-ink-muted">
            {"// sign in with your roll number to see your exams, practice and results."}
          </p>

          <div className="mt-8">
            {ssoError && (
              <p role="alert" className="mb-6 rounded-2xl border border-danger bg-danger-soft px-4 py-3 font-mono text-[13px] text-danger">
                [!] {ssoError}
              </p>
            )}
            {ssoEnabled && (
              <>
                <a
                  href={`/auth/sso${next ? `?next=${encodeURIComponent(next)}` : ""}`}
                  className="flex w-full items-center justify-center gap-2.5 rounded-full border border-line-strong bg-surface/40 py-3.5 text-[14px] font-medium text-ink backdrop-blur transition-colors hover:bg-hover"
                >
                  Sign in with your college account
                </a>
                <div className="my-7 flex items-center gap-4">
                  <div className="h-px flex-1 bg-line" />
                  <p className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-ink-subtle">or</p>
                  <div className="h-px flex-1 bg-line" />
                </div>
              </>
            )}
            <LoginForm next={next ?? ""} />
          </div>
        </div>

        <div className="border-t border-line/50 px-7 py-4 sm:px-9">
          <p className="font-mono text-[12px] leading-relaxed text-ink-subtle">
            [?] can&apos;t sign in? your exam administrator can reset your password.
          </p>
        </div>
      </LiquidGlass>

      {/* Bottom quick links */}
      <nav aria-label="Quick links" className="absolute bottom-6 flex flex-wrap justify-center gap-4 font-mono text-[12px] text-ink-subtle sm:bottom-8">
        <Link href="/system-check" className="transition-colors hover:text-ink"><span className="text-brand">[_]</span> system check</Link>
        <Link href="/help" className="transition-colors hover:text-ink"><span className="text-brand">[?]</span> help</Link>
        <Link href="/status" className="transition-colors hover:text-ink"><span className="text-brand">[~]</span> status</Link>
        <Link href="/security" className="transition-colors hover:text-ink"><span className="text-brand">[#]</span> security</Link>
      </nav>
    </main>
  );
}
