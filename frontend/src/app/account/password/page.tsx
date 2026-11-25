import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { AsciiField } from "@/components/site/ascii-field";
import { LiquidGlass } from "@/components/site/liquid-glass";
import { passwordResetByEmail } from "@/lib/auth-paths";
import { requireViewer } from "@/lib/server/session";
import { PASSWORD_COOKIE } from "@/lib/server/tokens";
import { homeFor } from "@/lib/viewer";
import { ChangePasswordForm } from "./form";

export const metadata: Metadata = { title: "Change password", robots: { index: false, follow: false } };

export default async function ChangePasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const viewer = await requireViewer();
  const required = Boolean((await cookies()).get(PASSWORD_COOKIE));
  const { next } = await searchParams;
  const title = required ? "Choose your password" : "Change password";
  const lead = required
    ? "// your college gave you a temporary password. replace it with one only you know."
    : "// at least 12 characters. you stay signed in on this device.";
  const emailReset = passwordResetByEmail();

  return (
    <main className="ascii relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <AsciiField />

      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="login-orb absolute -left-[18%] -top-[12%] h-[65%] w-[55%] rounded-pill bg-[radial-gradient(closest-side,var(--hero-aurora-1),transparent)] opacity-45" />
        <div className="login-orb absolute -bottom-[18%] -right-[12%] h-[60%] w-[50%] rounded-pill bg-[radial-gradient(closest-side,var(--glow-2),transparent)] opacity-35 [animation-delay:-7s]" />
      </div>

      <div aria-hidden className="pointer-events-none absolute h-[520px] w-[480px] rounded-panel bg-brand/10 blur-[80px]" />

      <LiquidGlass strong className="relative w-full max-w-[460px] overflow-hidden rounded-panel shadow-[var(--shadow-overlay)]">
        <div className="flex items-center justify-between px-7 pt-7 sm:px-9 sm:pt-9">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <Image src="/4.png" alt="" width={22} height={22} priority className="logo-light object-contain" />
            <Image src="/3.png" alt="" width={22} height={22} priority className="logo-dark object-contain" />
            <span className="font-mono text-[15px] font-semibold tracking-tight text-ink">AetherCode</span>
          </Link>
          {!required && (
            <Link
              href={homeFor(viewer)}
              className="rounded-pill border border-line px-3 py-1 font-mono text-[12px] text-ink-muted transition-colors hover:bg-hover hover:text-ink"
            >
              &larr; Back
            </Link>
          )}
        </div>

        <div className="px-7 pb-9 pt-8 sm:px-9">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-brand">Account</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.03em] text-ink">{title}</h1>
          <p className="mt-1.5 font-mono text-[13px] leading-relaxed text-ink-muted">{lead}</p>

          {required && (
            <p
              role="status"
              className="mt-6 rounded-2xl border border-brand/40 bg-brand-soft px-4 py-3 font-mono text-[13px] leading-relaxed text-ink"
            >
              [!] you must set a new password before you can open exams or the console.
            </p>
          )}

          <div className="mt-7">
            <ChangePasswordForm required={required} next={next ?? ""} />
          </div>
        </div>

        <div className="border-t border-line/50 px-7 py-4 sm:px-9">
          <p className="font-mono text-[12px] leading-relaxed text-ink-subtle">
            {required ? (
              "[*] after you save, we take you to your home screen."
            ) : emailReset ? (
              <>
                [*] forgot the current one?{" "}
                <Link href="/auth/forgot-password" className="text-brand underline-offset-2 hover:underline">
                  reset it by email
                </Link>
                .
              </>
            ) : (
              "[*] forgot the current one? ask your exam administrator to reset it."
            )}
          </p>
        </div>
      </LiquidGlass>
    </main>
  );
}
