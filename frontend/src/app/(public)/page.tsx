import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AudienceSwitch } from "@/components/site/audience-switch";
import { ExamDay } from "@/components/site/exam-day";
import { Hero } from "@/components/site/hero";
import { Manifesto } from "@/components/site/manifesto";
import { Numbers } from "@/components/site/numbers";
import { Poster } from "@/components/site/poster";
import { requireViewer } from "@/lib/server/session";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/server/tokens";
import { SITE } from "@/lib/site";
import { homeFor } from "@/lib/viewer";

export const metadata: Metadata = { alternates: { canonical: "/" } };

const TRUST = [
  { href: "/security", title: "Locked down", body: "Row-level security keeps colleges apart; mutual TLS between every service." },
  { href: "/architecture", title: "Sandboxed", body: "Your code runs with no network and hard CPU, memory and time limits." },
  { href: SITE.repo, title: "Open source", body: `Every line is public under the ${SITE.license}. Audit it, host it, improve it.` },
];

export default async function Landing() {
  // Signed in? The landing page is for visitors; go straight to work.
  const jar = await cookies();
  if (jar.get(ACCESS_COOKIE) || jar.get(REFRESH_COOKIE)) redirect(homeFor(await requireViewer()));

  return (
    <>
      <Hero />
      <Numbers />
      <ExamDay />
      <AudienceSwitch />
      <Manifesto />

      {/* Trust, in one line each, with the receipts linked. */}
      <section className="mx-auto max-w-6xl px-6 py-32">
        <div className="grid gap-px overflow-hidden rounded-[28px] border border-line bg-line md:grid-cols-3">
          {TRUST.map((item) => (
            <a key={item.title} href={item.href} className="group bg-surface p-8 transition-colors hover:bg-hover sm:p-10">
              <h3 className="flex items-center justify-between font-serif text-[1.9rem] text-ink">
                {item.title}
                <ArrowUpRight className="size-5 text-ink-subtle transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" />
              </h3>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">{item.body}</p>
            </a>
          ))}
        </div>
      </section>

      <Poster />
    </>
  );
}
