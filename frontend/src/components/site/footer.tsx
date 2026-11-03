import { Star } from "@phosphor-icons/react/ssr";
import Image from "next/image";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { CookieSettingsLink, ThemeSwitch } from "./footer-controls";

const COLUMNS = [
  {
    title: "Students",
    links: [
      { href: "/help", label: "Help center" },
      { href: "/system-check", label: "System check" },
      { href: "/status", label: "Status" },
      { href: "/changelog", label: "Changelog" },
    ],
  },
  {
    title: "Trust",
    links: [
      { href: "/security", label: "Security" },
      { href: "/architecture", label: "Architecture" },
      { href: "/about", label: "About" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy policy" },
      { href: "/terms", label: "Terms of use" },
    ],
  },
] as const;

/**
 * The site-wide footer: link columns and the operator line. Compact keeps one
 * quiet row for the app.
 */
export function Footer({ compact = false }: { compact?: boolean }) {
  const year = new Date().getFullYear();
  if (compact) {
    return (
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8">
          <p className="max-w-[60ch] text-[12.5px] leading-relaxed text-ink-subtle">
            © {year} {SITE.operator}
          </p>
          <div className="flex items-center gap-4 text-[13px]">
            <Link href="/privacy" className="text-ink-muted hover:text-ink">Privacy</Link>
            <Link href="/terms" className="text-ink-muted hover:text-ink">Terms</Link>
            <Link href="/help" className="text-ink-muted hover:text-ink">Help</Link>
            <CookieSettingsLink />
            <ThemeSwitch />
          </div>
        </div>
      </footer>
    );
  }

  const columns = [
    ...COLUMNS,
    {
      title: "Open source",
      links: [
        { href: SITE.repo, label: "GitHub" },
        { href: SITE.engineRepo, label: "Execution engine" },
        { href: `${SITE.repo}/blob/HEAD/LICENSE`, label: "License" },
        { href: SITE.advisories, label: "Report a vulnerability" },
      ],
    },
  ];
  return (
    <footer className="relative px-3 pb-3 pt-16 sm:px-4">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-[28px] border border-line bg-surface shadow-[var(--shadow-panel)]">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 p-7 sm:p-10 md:grid-cols-4 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="col-span-2 md:col-span-4 lg:col-span-1">
            <Link href="/" className="inline-flex items-center gap-2.5">
              <Image src="/4.png" alt="" width={22} height={22} className="logo-light object-contain" />
              <Image src="/3.png" alt="" width={22} height={22} className="logo-dark object-contain" />
              <span className="font-mono text-[16px] font-semibold tracking-tight text-ink">AetherCode</span>
            </Link>
            <p className="mt-4 max-w-[26ch] text-[15px] leading-relaxed text-ink-muted">Let your code do the talking. Open-source exams and practice for colleges.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <a href={SITE.repo} className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-[13.5px] font-medium text-brand-ink transition-opacity hover:opacity-90">
                <Star className="size-3.5" /> Star on GitHub
              </a>
              <Link href="/login" className="inline-flex items-center rounded-full border border-line-strong px-4 py-2 text-[13.5px] font-medium text-ink transition-colors hover:bg-hover">
                Sign in
              </Link>
            </div>
          </div>
          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <p className="font-mono text-[11.5px] uppercase tracking-[0.08em] text-ink-subtle">{column.title}</p>
              <ul className="mt-4 space-y-2.5 text-[14px]">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-ink-muted transition-colors hover:text-ink">
                      {link.label}
                    </Link>
                  </li>
                ))}
                {column.title === "Legal" && (
                  <li>
                    <CookieSettingsLink />
                  </li>
                )}
              </ul>
            </nav>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line bg-surface-2 px-7 py-4 text-[12.5px] text-ink-subtle sm:px-10">
          <p>
            © {year} {SITE.operatorShort}. {SITE.license}.
          </p>
          <div className="flex items-center gap-3">
            <Link href="/status" className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-ink-muted transition-colors hover:text-ink">
              <span aria-hidden className="size-1.5 rounded-full bg-success" /> Status
            </Link>
            <ThemeSwitch />
          </div>
        </div>
      </div>
    </footer>
  );
}
