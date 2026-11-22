import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ExamPreview } from "@/components/site/exam-preview";
import { Engine } from "@/components/site/engine";
import { ForceLandingDark } from "@/components/site/force-landing-dark";
import { Hero } from "@/components/site/hero";
import { Meet } from "@/components/site/meet";
import { Numbers } from "@/components/site/numbers";
import { ForColleges } from "@/components/site/for-colleges";
import { Platform } from "@/components/site/platform";
import { Statement } from "@/components/site/statement";
import { requireViewer } from "@/lib/server/session";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/server/tokens";
import { homeFor } from "@/lib/viewer";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function Landing() {
  // Signed in? The landing page is for visitors; go straight to work.
  const jar = await cookies();
  if (jar.get(ACCESS_COOKIE) || jar.get(REFRESH_COOKIE)) redirect(homeFor(await requireViewer()));

  return (
    <div className="relative bg-canvas">
      <ForceLandingDark />
      <Hero />

      <section className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <p className="inline-flex rounded-pill border border-line px-3 py-1 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
          Why AetherCode
        </p>
        <div className="mt-2">
          <Statement />
        </div>
      </section>

      <Meet />

      <section className="py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <p className="inline-flex rounded-pill border border-line px-3 py-1 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
            Product
          </p>
          <h2 className="heading mt-5 max-w-[18ch] text-[2.2rem] text-ink sm:text-[2.8rem]">The exam screen, as students see it</h2>
          <div className="relative mt-10 [perspective:1800px]">
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-[90%] max-w-5xl rounded-panel bg-brand/8 blur-[60px]" />
            <div data-tilt className="relative origin-top">
              <ExamPreview />
            </div>
          </div>
        </div>
      </section>

      <Platform />
      <Engine />
      <Numbers />
      <ForColleges />

      <section className="mx-auto max-w-6xl px-6 py-24 text-center sm:py-28">
        <h2 className="heading mx-auto max-w-[18ch] text-[2.4rem] text-ink sm:text-[3.2rem]">Sign in with the account your college gave you.</h2>
        <div data-reveal className="mt-9 flex flex-wrap justify-center gap-3 text-[15px] font-medium">
          <Link
            href="/login"
            className="rounded-[10px] bg-brand px-6 py-3 text-brand-ink shadow-[var(--shadow-panel)] transition-opacity hover:opacity-90"
          >
            Sign in
          </Link>
          <Link
            href="/help"
            className="rounded-[10px] border border-line-strong bg-surface px-6 py-3 text-ink shadow-[var(--shadow-panel)] transition-colors hover:bg-hover"
          >
            Read the help center
          </Link>
        </div>
      </section>
    </div>
  );
}
