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

const cell = "flex items-center rounded-full px-3 transition-colors sm:px-4 hover:bg-hover hover:text-ink";

/**
 * The public header as a terminal menu bar: one row of cells split by
 * hairlines, as wide as the page frame. Hover inverts a cell; the current
 * page carries a prompt. Phones keep the logo, sign-in and Menu.
 */
export function Navbar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 px-3 pt-3 font-mono">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-1 rounded-full border border-line bg-surface/80 px-2 text-[13px] shadow-[var(--shadow-panel)] backdrop-blur-md">
        <Link href="/" className={cn(cell, "h-9 gap-2.5 pl-3 text-ink")}>
          <Image src="/4.png" alt="" width={16} height={16} priority className="logo-light object-contain" />
          <Image src="/3.png" alt="" width={16} height={16} priority className="logo-dark object-contain" />
          <span className="font-semibold tracking-tight">AetherCode</span>
        </Link>

        <nav aria-label="Main" className="ml-2 hidden md:flex">
          {NAV.map((item) => {
            const current = item.href.startsWith("/") && !item.href.includes("#") && pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(cell, "h-9", current ? "bg-hover text-ink" : "text-ink-muted")}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex">
          <div className={cn(cell, "hidden h-9 text-ink-muted sm:flex")}>
            <ThemeIcon />
          </div>
          <Link href="/system-check" className={cn(cell, "hidden h-9 text-ink-muted lg:flex")}>
            system check
          </Link>
          <Link href="/login" className="flex h-9 items-center whitespace-nowrap rounded-full bg-brand px-4 text-brand-ink transition-opacity hover:opacity-90 sm:px-5">
            Sign in
          </Link>
          <details className="relative md:hidden">
            <summary className={cn(cell, "h-9 cursor-pointer list-none text-ink-muted [&::-webkit-details-marker]:hidden")}>Menu</summary>
            <nav aria-label="Main" className="absolute right-0 top-full mt-3 w-52 rounded-[var(--radius-surface)] overflow-hidden border border-line-strong bg-surface shadow-[var(--shadow-panel)]">
              {[...NAV, { href: "/system-check", label: "system check" }].map((item) => (
                <Link key={item.href} href={item.href} className="block border-b border-line px-4 py-2.5 text-ink last:border-b-0 hover:bg-hover">
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
