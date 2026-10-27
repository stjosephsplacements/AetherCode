import { ArrowUpRight } from "lucide-react";
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
 * The site-wide footer: link columns, then the name set huge and fading into
 * the page like a film's end card. Compact keeps one quiet row for the app.
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

  return (
    <footer className="overflow-hidden border-t border-line">
      <div className="mx-auto max-w-6xl px-6 pt-20">
        <div className="grid gap-12 lg:grid-cols-[1.5fr_repeat(4,1fr)]">
          <div className="max-w-[300px]">
            <p className="font-serif text-[1.9rem] leading-[1.1] text-ink">{SITE.tagline}</p>
            <a
              href={SITE.repo}
              className="mt-6 inline-flex items-center gap-2 rounded-full border border-line-strong px-4 py-2 text-[13.5px] text-ink transition-colors hover:bg-hover"
            >
              Star us on GitHub
              <ArrowUpRight className="size-3.5 text-ink-subtle" />
            </a>
          </div>
          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <p className="text-[13px] text-ink-subtle">{column.title}</p>
              <ul className="mt-4 space-y-3 text-[15px]">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-ink transition-colors hover:text-accent">
                      {link.label}
                    </Link>
                  </li>
                ))}
                {column.title === "Legal" && (
                  <li className="text-[15px] [&_button]:text-ink [&_button:hover]:text-accent">
                    <CookieSettingsLink />
                  </li>
                )}
              </ul>
            </nav>
          ))}
          <nav aria-label="Open source">
            <p className="text-[13px] text-ink-subtle">Open source</p>
            <ul className="mt-4 space-y-3 text-[15px]">
              <li>
                <a href={SITE.repo} className="text-ink transition-colors hover:text-accent">
                  GitHub
                </a>
              </li>
              <li>
                <a href={`${SITE.repo}/blob/HEAD/LICENSE`} className="text-ink transition-colors hover:text-accent">
                  License
                </a>
              </li>
              <li>
                <a href={SITE.advisories} className="text-ink transition-colors hover:text-accent">
                  Report a vulnerability
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
          <p className="max-w-[60ch] text-[12.5px] leading-relaxed text-ink-subtle">
            © {year} {SITE.operator}. Open source under the {SITE.license}.
          </p>
          <ThemeSwitch />
        </div>
      </div>

      <p
        aria-hidden
        className="mt-6 select-none whitespace-nowrap text-center font-serif text-[16.5vw] leading-[0.8] tracking-[-0.04em] text-transparent [background-clip:text] [background-image:linear-gradient(to_bottom,var(--ink)_10%,var(--accent)_55%,transparent_95%)] [-webkit-background-clip:text]"
      >
        {SITE.name}
      </p>
    </footer>
  );
}
