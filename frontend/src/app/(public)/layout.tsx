import type { Metadata } from "next";
import { Footer } from "@/components/site/footer";
import { Navbar } from "@/components/site/navbar";
import { ScrollProgress } from "@/components/site/scroll-progress";
import { SiteMotion } from "@/components/site/site-motion";
import { SmoothScroll } from "@/components/site/smooth-scroll";

// The app itself is never indexed (root layout); these public pages are.
export const metadata: Metadata = { robots: { index: true, follow: true } };

/** Shell for the public trust pages: a floating header, the content, the full footer. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <SmoothScroll>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#content"
          className="fixed left-4 top-4 z-50 -translate-y-24 rounded-full bg-brand px-4 py-2 text-[14px] font-medium text-brand-ink transition-transform focus:translate-y-0"
        >
          Skip to content
        </a>
        <Navbar />
        <main id="content" className="flex-1">
          {children}
        </main>
        <Footer />
        <ScrollProgress />
        <SiteMotion />
      </div>
    </SmoothScroll>
  );
}
