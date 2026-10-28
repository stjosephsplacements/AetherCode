import Link from "next/link";
import { SITE } from "@/lib/site";
import { CookieSettingsLink, ThemeIcon, ThemeSwitch } from "./footer-controls";

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
        { href: `${SITE.repo}/blob/HEAD/LICENSE`, label: "License" },
        { href: SITE.advisories, label: "Report a vulnerability" },
      ],
    },
  ];
  return (
    <footer className="relative border-t border-line bg-canvas font-mono text-[13px]">
      <div className="mx-auto max-w-6xl border-line lg:border-x">
        <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-[1.5fr_repeat(4,1fr)]">
          <div className="bg-canvas p-6">
            <p className="font-semibold text-ink">AetherCode</p>
            <p className="mt-2 text-ink-muted">{"// let your code"}<br />{"// do the talking."}</p>
            <a href={SITE.repo} className="mt-6 inline-block whitespace-nowrap border border-ink px-3 py-1.5 text-ink transition-colors hover:border-brand hover:bg-brand hover:text-brand-ink">
              [ star on github -&gt; ]
            </a>
          </div>
          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title} className="bg-canvas p-6">
              <p className="text-ink-subtle">[ {column.title.toLowerCase()} ]</p>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-ink-muted transition-colors hover:text-brand">
                      {link.label.toLowerCase()}
                    </Link>
                  </li>
                ))}
                {column.title === "Legal" && (
                  <li className="[&_button]:font-mono [&_button]:lowercase">
                    <CookieSettingsLink />
                  </li>
                )}
              </ul>
            </nav>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line bg-canvas px-6 py-4 text-[12px] text-ink-subtle">
          <p>
            (c) {year} {SITE.operatorShort}. {SITE.license}.
          </p>
          <ThemeIcon />
        </div>
      </div>
    </footer>
  );
}
