import Link from "next/link";
import { AccountMenu } from "@/components/account-menu";
import { Brand } from "@/components/brand";
import { NavLinks, type NavItem } from "@/components/nav-links";
import { accentStyle } from "@/lib/branding";
import type { Brand as CollegeBrand } from "@/lib/server/branding";
import type { Viewer } from "@/lib/viewer";

export function AppShell({ viewer, nav, brand, wide = false, children }: { viewer: Viewer; nav: NavItem[]; brand?: CollegeBrand; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh" style={brand?.color ? accentStyle(brand.color) : undefined}>
      <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col bg-sidebar lg:flex print:hidden">
        <Link href="/" className="flex h-14 items-center px-4">
          <Brand brand={brand} />
        </Link>
        <nav aria-label="Main" className="flex-1 px-2.5 pt-2">
          <NavLinks items={nav} />
        </nav>
        <div className="p-2.5">
          <AccountMenu viewer={viewer} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-canvas/90 px-4 backdrop-blur lg:hidden print:hidden">
          <Link href="/">
            <Brand brand={brand} />
          </Link>
          <AccountMenu viewer={viewer} compact />
        </header>
        <main className={`mx-auto w-full flex-1 px-5 pb-24 pt-10 sm:px-8 lg:pt-14 ${wide ? "max-w-[1120px]" : "max-w-[880px]"}`}>{children}</main>
      </div>
    </div>
  );
}
