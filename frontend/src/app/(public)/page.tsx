import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ExamStory } from "@/components/site/exam-story";
import { Features } from "@/components/site/features";
import { Hero } from "@/components/site/hero";
import { Manifesto } from "@/components/site/manifesto";
import { MomentWall } from "@/components/site/moment-wall";
import { Poster } from "@/components/site/poster";
import { requireViewer } from "@/lib/server/session";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/server/tokens";
import { SITE } from "@/lib/site";
import { homeFor } from "@/lib/viewer";

export const metadata: Metadata = { alternates: { canonical: "/" } };

const AUDIENCES = [
  {
    title: "For students",
    lede: "Practice like it counts, because the exam will look exactly the same.",
    points: [
      `${SITE.languages.length} languages, from C to Go, in a proper code editor.`,
      "Practice problems, contests and interview stories from seniors, in one place.",
      "Results the moment staff release them, with every test case explained.",
    ],
  },
  {
    title: "For colleges",
    lede: "Run fair exams for hundreds of students at once, on your own servers.",
    points: [
      "Safe Exam Browser lockdown and lab-network rules, checked on every request.",
      "Live monitoring, extra time per student, and similarity checks after the exam.",
      "Self-hosted and open source. Your students' data never leaves your servers.",
    ],
  },
];

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

      <Manifesto />

      {/* Numbers */}
      <section aria-label="AetherCode in numbers" className="border-y border-line">
        <dl className="mx-auto grid max-w-6xl px-6 sm:grid-cols-3">
          {[
            { value: SITE.stats.students, label: "students have taken exams here" },
            { value: SITE.stats.runs, label: "code runs judged" },
            { value: String(SITE.languages.length), label: "languages, compiled and sandboxed" },
          ].map((stat) => (
            <div key={stat.label} className="flex flex-col-reverse border-line py-10 sm:border-l sm:px-10 sm:first:border-l-0 sm:first:pl-0">
              <dt className="mt-2 text-[14.5px] text-ink-muted">{stat.label}</dt>
              <dd className="font-serif text-[3.6rem] leading-none tracking-tight text-ink">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <ExamStory />

      <Features />

      <MomentWall />

      {/* Two audiences, side by side. */}
      <section className="mx-auto grid max-w-6xl gap-16 px-6 py-32 lg:grid-cols-2 lg:gap-20">
        {AUDIENCES.map((column) => (
          <div key={column.title}>
            <h2 className="display text-[2.4rem] text-ink">{column.title}</h2>
            <p className="mt-3 max-w-[30rem] text-[16px] leading-relaxed text-ink-muted">{column.lede}</p>
            <ul className="mt-8 border-t border-line">
              {column.points.map((point) => (
                <li key={point} className="border-b border-line py-5 text-[15.5px] leading-relaxed text-ink">
                  {point}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* Trust, in one line each, with the receipts linked. */}
      <section className="mx-auto max-w-6xl px-6 pb-32">
        <div className="grid gap-10 md:grid-cols-3">
          {TRUST.map((item) => (
            <a key={item.title} href={item.href} className="group">
              <h3 className="flex items-center gap-1.5 text-[17px] font-semibold text-ink">
                {item.title}
                <ArrowUpRight className="size-4 text-ink-subtle transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{item.body}</p>
            </a>
          ))}
        </div>
      </section>

      <Poster />
    </>
  );
}
