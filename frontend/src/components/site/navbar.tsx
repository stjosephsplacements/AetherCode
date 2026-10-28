"use client";

import { Menu } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";
import { ThemeIcon } from "./footer-controls";

const NAV = [
  { href: "/#product", label: "Product" },
  { href: "/security", label: "Security" },
  { href: "/help", label: "Help" },
  { href: "/status", label: "Status" },
  { href: "/about", label: "About" },
  { href: SITE.repo, label: "GitHub" },
];

/** One full-width bar for the public pages; phones get the links in a disclosure menu. */
export function Navbar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/75 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/4.png" alt="" width={20} height={20} priority className="logo-light object-contain" />
          <Image src="/3.png" alt="" width={20} height={20} priority className="logo-dark object-contain" />
          <span className="text-[15px] font-semibold tracking-tight text-ink">AetherCode</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-6 text-[14px] md:flex">
          {NAV.map((item) => {
            const current = item.href.startsWith("/") && !item.href.includes("#") && pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn("transition-colors", current ? "text-ink" : "text-ink-muted hover:text-ink")}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeIcon />
          <Link href="/system-check" className="hidden text-[14px] text-ink-muted transition-colors hover:text-ink sm:block">
            System check
          </Link>
          <Button asChild size="sm" className="ml-2 h-8 rounded-[8px] px-3.5">
            <Link href="/login">Sign in</Link>
          </Button>
          <details className="relative md:hidden">
            <summary className="grid size-9 cursor-pointer list-none place-items-center rounded-[8px] text-ink-muted hover:bg-hover hover:text-ink [&::-webkit-details-marker]:hidden">
              <Menu className="size-4" />
              <span className="sr-only">Menu</span>
            </summary>
            <nav aria-label="Main" className="absolute right-0 top-11 w-52 rounded-[12px] border border-line-strong bg-surface p-1.5 shadow-[var(--shadow-overlay)]">
              {[...NAV, { href: "/system-check", label: "System check" }].map((item) => (
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
