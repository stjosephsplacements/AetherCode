"use client";

import { ArrowRight, Menu } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ThemeIcon } from "./footer-controls";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/help", label: "Help" },
  { href: "/status", label: "Status" },
  { href: "/security", label: "Security" },
  { href: "/about", label: "About" },
];

/**
 * The public header: the logo on the left, a white pill of links in the
 * middle with the current page as a dark tab, and sign-in on the right.
 * Phones get the links in a disclosure menu.
 */
export function Navbar() {
  const pathname = usePathname();
  return (
    <header className="pointer-events-none sticky top-0 z-40 px-4 pb-4 pt-4 sm:px-6 [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_details]:pointer-events-auto [&_nav]:pointer-events-auto">
      <div className="mx-auto flex max-w-7xl items-center gap-3">
        <div className="mr-auto md:mr-0 md:flex-1">
          <Link href="/" className="inline-flex items-center gap-2.5 rounded-[10px] bg-surface/80 px-3 py-2 ring-1 ring-line-strong backdrop-blur-md">
          <Image src="/4.png" alt="" width={22} height={22} priority className="logo-light object-contain" />
          <Image src="/3.png" alt="" width={22} height={22} priority className="logo-dark object-contain" />
          <span className="text-[15px] font-semibold tracking-tight text-ink">AetherCode</span>
          </Link>
        </div>

        <nav aria-label="Main" className="hidden items-center gap-0.5 rounded-[10px] bg-[#f2f2f2] p-1 text-[13.5px] md:flex">
          {NAV.map((item) => {
            const current = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn("rounded-[7px] px-3.5 py-1.5 font-medium transition-colors", current ? "bg-[#050505] text-white" : "text-[#3a3a3a] hover:text-black")}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1.5 md:flex-1 md:justify-end">
          <span className="rounded-[10px] bg-surface/80 ring-1 ring-line-strong backdrop-blur-md [&>button]:rounded-[10px]">
            <ThemeIcon />
          </span>
          <Link href="/login" className="group inline-flex items-center gap-2.5 rounded-[10px] bg-surface/80 py-1 pl-1 pr-4 backdrop-blur-md text-[14px] font-medium text-ink ring-1 ring-line-strong transition-colors hover:bg-hover">
            <span className="grid size-8 place-items-center rounded-[7px] bg-brand text-brand-ink">
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
            Sign in
          </Link>
          <details className="relative md:hidden">
            <summary className="grid size-10 cursor-pointer list-none place-items-center rounded-[10px] text-ink-muted hover:bg-hover hover:text-ink [&::-webkit-details-marker]:hidden">
              <Menu className="size-4" />
              <span className="sr-only">Menu</span>
            </summary>
            <nav aria-label="Main" className="absolute right-0 top-12 w-48 rounded-[12px] border border-line-strong bg-surface p-2 shadow-[var(--shadow-overlay)]">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="block rounded-[8px] px-3 py-2 text-[15px] text-ink hover:bg-hover">
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
