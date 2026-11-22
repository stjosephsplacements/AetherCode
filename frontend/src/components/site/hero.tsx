import Image from "next/image";
import Link from "next/link";
import { SITE } from "@/lib/site";

const SHORTCUTS = [
  { href: "/system-check", label: "System check" },
  { href: "/help", label: "Help center" },
  { href: "/security", label: "Security" },
  { href: "/architecture", label: "Architecture" },
];

const TRUST = ["St. Joseph's Group", "Campus labs", "Placement drives", "Timed contests"];

const FLOATS = [
  { label: "Run", detail: "sample tests", x: "12%", y: "22%" },
  { label: "Submit", detail: "hidden tests", x: "68%", y: "18%" },
  { label: "SEB", detail: "lockdown on", x: "18%", y: "62%" },
  { label: "Judge", detail: "sandbox OK", x: "72%", y: "58%" },
];

/** Docker-style dark hero: brand-led headline, CTAs, product floats, trust strip. */
export function Hero() {
  return (
    <section className="relative isolate overflow-hidden rounded-b-[2.5rem] bg-[#050505] px-4 pb-10 pt-6 sm:rounded-b-[3.5rem] sm:px-6 sm:pb-14">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 50% 35%, rgb(188 255 0 / 0.07), transparent 70%), radial-gradient(ellipse 40% 30% at 80% 10%, rgb(233 235 230 / 0.04), transparent 60%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.35]"
        style={{
          backgroundImage: "radial-gradient(rgb(233 235 230 / 0.22) 0.7px, transparent 0.7px)",
          backgroundSize: "22px 22px",
          maskImage: "radial-gradient(ellipse 60% 55% at 50% 40%, black, transparent 75%)",
        }}
      />

      <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 pt-10 sm:pt-14 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
        <div className="max-w-[18ch] lg:max-w-[16ch]">
          <Link
            href="/changelog"
            className="inline-flex items-center gap-2 rounded-pill border border-line-strong bg-surface/60 px-3 py-1.5 text-[12.5px] text-ink-muted backdrop-blur transition-colors hover:border-brand/40 hover:text-ink"
          >
            <span className="font-semibold uppercase tracking-[0.08em] text-brand">New</span>
            College contests and practice arena
            <span aria-hidden className="text-ink-subtle">
              →
            </span>
          </Link>
          <h1 className="mt-6 font-sans text-[clamp(2.6rem,7vw,4.6rem)] font-bold leading-[0.98] tracking-[-0.045em] text-ink">
            {SITE.name}
            <span className="mt-3 block text-[clamp(1.35rem,3.4vw,2.15rem)] font-semibold leading-[1.15] tracking-[-0.03em] text-ink">
              {SITE.tagline}
            </span>
          </h1>
        </div>
        <div className="max-w-[34rem] pb-1 lg:max-w-[28rem]">
          <p className="text-[16px] leading-relaxed text-ink-muted sm:text-[17px]">
            Timed coding exams and practice for colleges. Same editor, same hidden tests, a fair score for every student — locked down when it matters.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/login"
              className="inline-flex h-11 items-center rounded-[10px] bg-brand px-5 text-[14.5px] font-semibold text-brand-ink transition-opacity hover:opacity-90"
            >
              Sign in
            </Link>
            <Link
              href="/help"
              className="inline-flex h-11 items-center rounded-[10px] border border-line-strong bg-transparent px-5 text-[14.5px] font-medium text-ink transition-colors hover:bg-hover"
            >
              How it works
            </Link>
          </div>
          <nav aria-label="Before your exam" className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-ink-subtle">
            {SHORTCUTS.map((item) => (
              <Link key={item.href} href={item.href} className="transition-colors hover:text-ink">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <div className="relative mx-auto mt-14 h-[220px] max-w-5xl sm:mt-16 sm:h-[280px]">
        {FLOATS.map((item) => (
          <div
            key={item.label}
            data-reveal
            className="absolute rounded-[12px] border border-line-strong bg-surface/80 px-3.5 py-2.5 shadow-[var(--shadow-panel)] backdrop-blur-md"
            style={{ left: item.x, top: item.y }}
          >
            <p className="text-[13px] font-semibold text-ink">{item.label}</p>
            <p className="text-[12px] text-ink-muted">{item.detail}</p>
          </div>
        ))}
        <div
          aria-hidden
          className="absolute left-1/2 top-1/2 flex size-[min(58vw,240px)] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface/40"
        >
          <Image src="/3.png" alt="" width={72} height={72} priority className="object-contain opacity-90" />
        </div>
      </div>

      <div className="mx-auto mt-10 max-w-6xl border-t border-line pt-8 sm:mt-12">
        <p className="text-[12px] uppercase tracking-[0.14em] text-ink-subtle">Built for campuses that run real exams</p>
        <ul className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3 text-[14px] font-medium text-ink-muted">
          {TRUST.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
