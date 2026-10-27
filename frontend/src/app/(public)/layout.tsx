import type { Metadata } from "next";
import { Footer } from "@/components/site/footer";
import { Navbar } from "@/components/site/navbar";
import { ScrollProgress } from "@/components/site/scroll-progress";
import { SmoothScroll } from "@/components/site/smooth-scroll";

// The app itself is never indexed (root layout); these public pages are.
export const metadata: Metadata = { robots: { index: true, follow: true } };

/** Shell for the public trust pages: a floating header, the content, the full footer. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <SmoothScroll>
      <div className="flex min-h-dvh flex-col">
        <Navbar />
        <main id="content" className="flex-1">
          {children}
        </main>
        <Footer />
        <ScrollProgress />
      </div>
    </SmoothScroll>
  );
}
