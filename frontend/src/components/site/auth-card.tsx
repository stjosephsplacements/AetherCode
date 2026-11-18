import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

/** The page shell for the sign-in-adjacent pages (forgot and reset password). */
export function AuthCard({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[460px] rounded-[32px] border border-line bg-surface/70 shadow-[var(--shadow-overlay)] backdrop-blur">
        <div className="flex items-center justify-between px-7 pt-7 sm:px-9 sm:pt-9">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <Image src="/4.png" alt="" width={22} height={22} priority className="logo-light object-contain" />
            <Image src="/3.png" alt="" width={22} height={22} priority className="logo-dark object-contain" />
            <span className="font-mono text-[15px] font-semibold tracking-tight text-ink">AetherCode</span>
          </Link>
          <Link href="/login" className="rounded-full border border-line px-3 py-1 font-mono text-[12px] text-ink-muted transition-colors hover:bg-hover hover:text-ink">
            &larr; Sign in
          </Link>
        </div>
        <div className="px-7 pb-9 pt-8 sm:px-9">
          <h1 className="text-[26px] font-semibold tracking-[-0.03em] text-ink">{title}</h1>
          <p className="mt-1.5 font-mono text-[13px] leading-relaxed text-ink-muted">{lead}</p>
          <div className="mt-7">{children}</div>
        </div>
      </div>
    </main>
  );
}

export const authFieldClass =
  "h-12 w-full rounded-2xl border border-line-strong bg-surface/50 px-4 font-mono text-[15px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15";
export const authButtonClass =
  "w-full rounded-full bg-brand py-3.5 text-[15px] font-semibold text-brand-ink transition-opacity disabled:opacity-60";
