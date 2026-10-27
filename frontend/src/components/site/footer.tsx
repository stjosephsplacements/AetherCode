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

/** The site-wide footer: legal, trust and help links, theme and cookie controls. */
export function Footer({ compact = false }: { compact?: boolean }) {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-line">
      <div className={compact ? "mx-auto max-w-6xl px-6 py-8" : "mx-auto max-w-6xl px-6 py-14"}>
        {!compact && (
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
            <div className="max-w-[260px]">
              <Link href="/" className="inline-flex items-center gap-2.5">
                <Image src="/4.png" alt="" width={24} height={24} className="logo-light object-contain" />
                <Image src="/3.png" alt="" width={24} height={24} className="logo-dark object-contain" />
                <span className="text-[15px] font-semibold tracking-tight text-ink">{SITE.name}</span>
              </Link>
              <p className="mt-3 font-serif text-[1.35rem] leading-snug text-ink">{SITE.tagline}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">Open source under the {SITE.license}.</p>
            </div>
            {COLUMNS.map((column) => (
              <nav key={column.title} aria-label={column.title}>
                <p className="text-[13px] font-medium text-ink">{column.title}</p>
                <ul className="mt-3 space-y-2.5 text-[14px]">
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
            <nav aria-label="Open source">
              <p className="text-[13px] font-medium text-ink">Open source</p>
              <ul className="mt-3 space-y-2.5 text-[14px]">
                <li>
                  <a href={SITE.repo} className="text-ink-muted transition-colors hover:text-ink">
                    GitHub
                  </a>
                </li>
                <li>
                  <a href={`${SITE.repo}/blob/HEAD/LICENSE`} className="text-ink-muted transition-colors hover:text-ink">
                    License
                  </a>
                </li>
                <li>
                  <a href={SITE.advisories} className="text-ink-muted transition-colors hover:text-ink">
                    Report a vulnerability
                  </a>
                </li>
              </ul>
            </nav>
          </div>
        )}
        <div className={compact ? "flex flex-wrap items-center justify-between gap-4" : "mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6"}>
          <p className="max-w-[60ch] text-[12.5px] leading-relaxed text-ink-subtle">
            © {year} {SITE.operator}
          </p>
          <div className="flex items-center gap-4 text-[13px]">
            {compact && (
              <>
                <Link href="/privacy" className="text-ink-muted hover:text-ink">Privacy</Link>
                <Link href="/terms" className="text-ink-muted hover:text-ink">Terms</Link>
                <Link href="/help" className="text-ink-muted hover:text-ink">Help</Link>
                <CookieSettingsLink />
              </>
            )}
            <ThemeSwitch />
          </div>
        </div>
      </div>
    </footer>
  );
}
