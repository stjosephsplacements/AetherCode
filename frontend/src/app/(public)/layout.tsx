import type { Metadata } from "next";
import { Footer } from "@/components/site/footer";
import { AsciiField } from "@/components/site/ascii-field";
import { Navbar } from "@/components/site/navbar";
import { PathBar } from "@/components/site/path-bar";
import { SiteMotion } from "@/components/site/site-motion";
import { SmoothScroll } from "@/components/site/smooth-scroll";

// The app itself is never indexed (root layout); these public pages are.
export const metadata: Metadata = { robots: { index: true, follow: true } };

/** Shell for the public trust pages: a floating header, the content, the full footer. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <SmoothScroll>
      <div className="ascii relative flex min-h-dvh flex-col">
        {/* Every public page sits in the same frame over the same ASCII field. */}
        <AsciiField />
        <a
          href="#content"
          className="fixed left-4 top-4 z-50 -translate-y-24 rounded-full bg-brand px-4 py-2 text-[14px] font-medium text-brand-ink transition-transform focus:translate-y-0"
        >
          Skip to content
        </a>
        <Navbar />
        <PathBar />
        <main id="content" className="flex-1">
          {children}
        </main>
        <Footer />
        <SiteMotion />
      </div>
    </SmoothScroll>
  );
}
