import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ExamPreview } from "@/components/site/exam-preview";
import { Hero } from "@/components/site/hero";
import { Meet } from "@/components/site/meet";
import { Numbers } from "@/components/site/numbers";
import { OpenSource } from "@/components/site/open-source";
import { Platform } from "@/components/site/platform";
import { Statement } from "@/components/site/statement";
import { Button } from "@/components/ui/button";
import { requireViewer } from "@/lib/server/session";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/server/tokens";
import { homeFor } from "@/lib/viewer";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function Landing() {
  // Signed in? The landing page is for visitors; go straight to work.
  const jar = await cookies();
  if (jar.get(ACCESS_COOKIE) || jar.get(REFRESH_COOKIE)) redirect(homeFor(await requireViewer()));

  return (
    // HackerRank-style frame: two hairlines down the content edges, a rule between sections.
    <div className="relative divide-y divide-line">
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 -z-10 hidden w-full max-w-6xl -translate-x-1/2 border-x border-line lg:block" />
      <Hero />
      <Statement />
      <Meet />

      <section className="bg-surface-2 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="heading text-[2.2rem] text-ink sm:text-[2.8rem]">The exam screen, as students see it</h2>
          <div className="mt-10 [perspective:1800px]">
            <div data-tilt className="origin-top">
              <ExamPreview />
            </div>
          </div>
        </div>
      </section>

      <Platform />
      <Numbers />
      <OpenSource />

      <section className="mx-auto max-w-6xl px-6 py-28 text-center">
        <h2 className="heading mx-auto max-w-[18ch] text-[2.4rem] text-ink sm:text-[3.2rem]">Sign in with the account your college gave you.</h2>
        <div data-reveal className="mt-9 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" className="rounded-[10px]">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="lg" variant="secondary" className="rounded-[10px]">
            <Link href="/help">Read the help center</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
