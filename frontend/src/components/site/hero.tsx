import Link from "next/link";
import { AsciiTorus } from "./ascii-torus";
import { WORDMARK, WORDMARK_COLUMNS } from "./wordmark";

const SHORTCUTS = [
  { href: "/system-check", glyph: "[_]", label: "check my laptop" },
  { href: "/help", glyph: "[?]", label: "help center" },
  { href: "/status", glyph: "[~]", label: "status" },
  { href: "/security", glyph: "[#]", label: "security" },
];

/** The wordmark in text over a spinning ASCII torus, the tagline, and the next steps as bracketed links. */
export function Hero() {
  return (
    <section className="relative isolate flex min-h-[calc(100svh-56px)] flex-col items-center justify-center overflow-hidden px-4 py-20 text-center">
      {/* A slow aurora behind the torus, on wide screens only. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-20 hidden overflow-hidden md:block">
        <div className="aurora absolute -left-[10%] top-[8%] h-[55%] w-[55%] bg-[radial-gradient(closest-side,var(--brand-soft),transparent)]" />
        <div className="aurora absolute -right-[8%] top-[30%] h-[60%] w-[50%] bg-[radial-gradient(closest-side,var(--glow-2),transparent)] [animation-delay:-9s]" />
      </div>
      <AsciiTorus className="ascii-art pointer-events-none absolute left-1/2 top-1/2 -z-10 -translate-x-1/2 -translate-y-1/2 select-none text-ink/30" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_62%_40%_at_50%_48%,var(--canvas)_35%,transparent)]" />

      <h1 className="sr-only">AetherCode: Let your code do the talking.</h1>
      <pre
        data-reveal
        aria-hidden
        className="ascii-art text-left text-brand"
        style={{ "--columns": WORDMARK_COLUMNS + 6 } as React.CSSProperties}
      >
        {WORDMARK}
      </pre>
      <p data-reveal aria-hidden className="heading mt-8 text-[1.9rem] leading-[1.3] text-ink sm:text-[2.8rem]">
        <span className="marker">Let your code do the talking.</span>
      </p>
      <p data-reveal className="mt-5 text-[14px] text-ink-muted">
        <span className="bg-canvas px-1">{"// coding exams and practice for colleges. open source, self-hosted."}</span>
      </p>

      <div data-reveal className="mt-10 flex flex-wrap justify-center gap-3 text-[15px]">
        <Link href="/login" className="bg-brand px-5 py-3 text-brand-ink shadow-[4px_4px_0_var(--ink)] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5">
          [ sign in -&gt; ]
        </Link>
        <Link href="/help" className="border border-ink bg-canvas px-5 py-3 text-ink shadow-[4px_4px_0_var(--ink)] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5">
          [ how it works ]
        </Link>
      </div>

      <nav data-reveal aria-label="Before your exam" className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[13px]">
        {SHORTCUTS.map(({ href, glyph, label }) => (
          <Link key={href} href={href} className="bg-canvas px-1 text-ink-muted transition-colors hover:text-ink">
            <span className="text-brand">{glyph}</span> {label}
          </Link>
        ))}
      </nav>
    </section>
  );
}
