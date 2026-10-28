import { ArrowRight, BookOpen, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AudienceSwitch } from "@/components/site/audience-switch";
import { Bento } from "@/components/site/bento";
import { BugHunt } from "@/components/site/bug-hunt";
import { Hero } from "@/components/site/hero";
import { LanguageStrip } from "@/components/site/language-strip";
import { Numbers } from "@/components/site/numbers";
import { OpenSource } from "@/components/site/open-source";
import { TiltIn } from "@/components/site/tilt-in";
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
    <>
      <Hero />

      {/* The product, playable: one bug, three candidate fixes. */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-24 sm:py-28 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <h2 className="heading text-[2.3rem] sm:text-[3.1rem] text-ink">Every run shows you the tests.</h2>
          <p className="mt-5 max-w-[26rem] text-[16px] leading-relaxed text-ink-muted">
            Run your code on the sample tests and see the expected output beside yours. When you submit, hidden tests decide the
            marks and your best submission counts. Try it: one test below fails.
          </p>
        </div>
        <TiltIn>
          <BugHunt />
        </TiltIn>
      </section>

      <Numbers />
      <LanguageStrip />
      <Bento />
      <OpenSource />
      <AudienceSwitch />

      {/* Closing: the ask on the left, two quiet next steps on the right. */}
      <section className="mx-auto grid max-w-6xl gap-12 border-t border-line px-6 py-24 sm:py-28 lg:grid-cols-2">
        <div>
          <h2 className="heading text-[2.3rem] sm:text-[3.1rem] text-ink">
            Sign in with the account your college gave you.
          </h2>
          <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Button asChild size="lg">
              <Link href="/login">
                Sign in
                <ArrowRight />
              </Link>
            </Button>
            <Link href="/system-check" className="group inline-flex items-center gap-1.5 text-[15px] font-medium text-ink">
              Check my laptop
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
        <div className="grid gap-8 sm:grid-cols-2">
          {[
            { icon: BookOpen, title: "New here?", body: "The help center walks through exams, results and practice.", href: "/help", cta: "Read the guide" },
            { icon: ShieldCheck, title: "How it's secured", body: "Isolation between colleges, sandboxed judging, and how to report a flaw.", href: "/security", cta: "See security" },
          ].map(({ icon: Icon, ...item }) => (
            <div key={item.title}>
              <Icon className="size-6 text-accent" strokeWidth={1.75} />
              <h3 className="mt-4 text-[17px] font-semibold text-ink">{item.title}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-ink-muted">{item.body}</p>
              <Link href={item.href} className="group mt-3 inline-flex items-center gap-1.5 text-[15px] font-medium text-accent">
                {item.cta}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
