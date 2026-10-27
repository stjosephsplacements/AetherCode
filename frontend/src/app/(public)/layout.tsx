import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { Metadata } from "next";
import { Footer } from "@/components/site/footer";

// The app itself is never indexed (root layout); these public pages are.
export const metadata: Metadata = { robots: { index: true, follow: true } };

const NAV = [
  { href: "/help", label: "Help" },
  { href: "/status", label: "Status" },
  { href: "/security", label: "Security" },
  { href: "/about", label: "About" },
];

/** Shell for the public trust pages: a light header, the content, the full footer. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/4.png" alt="" width={24} height={24} priority className="logo-light object-contain" />
            <Image src="/3.png" alt="" width={24} height={24} priority className="logo-dark object-contain" />
            <span className="text-[15px] font-semibold tracking-tight text-ink">AetherCode</span>
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 text-[14px] sm:flex">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="rounded-full px-3 py-1.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink">
                {item.label}
              </Link>
            ))}
          </nav>
          <Button asChild size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </header>
      <main id="content" className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  );
}
