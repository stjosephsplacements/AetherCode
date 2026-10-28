"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";
import { ThemeIcon } from "./footer-controls";

const NAV = [
  { href: "/#product", label: "product" },
  { href: "/security", label: "security" },
  { href: "/help", label: "help" },
  { href: "/status", label: "status" },
  { href: "/about", label: "about" },
  { href: SITE.repo, label: "github" },
];

const cell = "flex items-center border-line px-3 transition-colors sm:px-4 hover:bg-brand hover:text-brand-ink";

/**
 * The public header as a terminal menu bar: one row of cells split by
 * hairlines, as wide as the page frame. Hover inverts a cell; the current
 * page carries a prompt. Phones keep the logo, sign-in and [menu].
 */
export function Navbar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 bg-canvas font-mono">
      <div className="mx-auto flex h-12 max-w-6xl border-b border-line text-[13px] lg:border-x">
        <Link href="/" className={cn(cell, "gap-2.5 border-r pl-5 text-ink")}>
          <Image src="/4.png" alt="" width={16} height={16} priority className="logo-light object-contain" />
          <Image src="/3.png" alt="" width={16} height={16} priority className="logo-dark object-contain" />
          <span className="font-semibold tracking-tight">AetherCode</span>
        </Link>

        <nav aria-label="Main" className="hidden md:flex">
          {NAV.map((item) => {
            const current = item.href.startsWith("/") && !item.href.includes("#") && pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(cell, "border-r", current ? "text-ink" : "text-ink-muted")}
              >
                {current && <span className="text-brand">&gt;&nbsp;</span>}
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex">
          <div className={cn(cell, "hidden border-l text-ink-muted sm:flex [&>button]:hover:text-brand-ink")}>
            <ThemeIcon />
          </div>
          <Link href="/system-check" className={cn(cell, "hidden border-l text-ink-muted lg:flex")}>
            system check
          </Link>
          <Link href="/login" className="flex items-center whitespace-nowrap bg-brand px-3 text-brand-ink transition-opacity hover:opacity-90 sm:px-5">
            [ sign in ]
          </Link>
          <details className="relative md:hidden">
            <summary className={cn(cell, "h-full cursor-pointer list-none border-l text-ink-muted [&::-webkit-details-marker]:hidden")}>[menu]</summary>
            <nav aria-label="Main" className="absolute right-0 top-full w-52 border border-ink bg-surface shadow-[4px_4px_0_var(--ink)]">
              {[...NAV, { href: "/system-check", label: "system check" }].map((item) => (
                <Link key={item.href} href={item.href} className="block border-b border-line px-4 py-2.5 text-ink last:border-b-0 hover:bg-brand hover:text-brand-ink">
                  {item.label}
                </Link>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
