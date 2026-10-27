import { Menu } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ThemeIcon } from "./footer-controls";

const NAV = [
  { href: "/help", label: "Help" },
  { href: "/status", label: "Status" },
  { href: "/security", label: "Security" },
  { href: "/about", label: "About" },
];

/** A floating pill header for the public pages; phones get the links in a disclosure menu. */
export function Navbar() {
  return (
    <header className="sticky top-3 z-40 px-3 sm:top-4">
      <div className="mx-auto flex h-14 max-w-4xl items-center gap-2 rounded-full border border-line-strong bg-surface/75 pl-5 pr-2 shadow-[var(--shadow-panel)] backdrop-blur-xl">
        <Link href="/" className="mr-auto flex items-center gap-2.5">
          <Image src="/4.png" alt="" width={22} height={22} priority className="logo-light object-contain" />
          <Image src="/3.png" alt="" width={22} height={22} priority className="logo-dark object-contain" />
          <span className="text-[15px] font-semibold tracking-tight text-ink">AetherCode</span>
        </Link>
        <nav aria-label="Main" className="hidden items-center text-[14px] md:flex">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-full px-3.5 py-1.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink">
              {item.label}
            </Link>
          ))}
        </nav>
        <ThemeIcon />
        <Button asChild size="sm" className="h-10 px-5">
          <Link href="/login">Sign in</Link>
        </Button>
        <details className="group relative md:hidden">
          <summary className="grid size-10 cursor-pointer list-none place-items-center rounded-full text-ink-muted hover:bg-hover hover:text-ink [&::-webkit-details-marker]:hidden">
            <Menu className="size-4" />
            <span className="sr-only">Menu</span>
          </summary>
          <nav aria-label="Main" className="absolute right-0 top-12 w-48 rounded-2xl border border-line-strong bg-surface p-2 shadow-[var(--shadow-overlay)]">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="block rounded-xl px-3 py-2 text-[15px] text-ink hover:bg-hover">
                {item.label}
              </Link>
            ))}
          </nav>
        </details>
      </div>
    </header>
  );
}
