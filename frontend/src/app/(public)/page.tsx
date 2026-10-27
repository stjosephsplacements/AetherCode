import { ArrowUpRight, Code2, Gauge, LockKeyhole, ScanEye, ShieldCheck, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BugHunt } from "@/components/site/bug-hunt";
import { Button } from "@/components/ui/button";
import { requireViewer } from "@/lib/server/session";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/server/tokens";
import { SITE } from "@/lib/site";
import { homeFor } from "@/lib/viewer";

export const metadata: Metadata = { alternates: { canonical: "/" } };

const STEPS = [
  { title: "Open your exam", body: "One link, or Safe Exam Browser if your college locks it down. Your timer starts when you press Start." },
  { title: "Code like it's your IDE", body: "A real editor with your language, run against sample tests as often as you like. Your code saves as you type." },
  { title: "Submit and see it land", body: "Hidden tests decide your marks. Each question keeps your best submission, so a late bad one can't hurt you." },
];

const STUDENTS = [
  { icon: Code2, text: `${SITE.languages.length} languages, from C to Go, in a proper code editor.` },
  { icon: Sparkles, text: "Practice problems, contests and interview stories from seniors, in one place." },
  { icon: Gauge, text: "Results the moment staff release them, with every test case explained." },
];

const COLLEGES = [
  { icon: LockKeyhole, text: "Safe Exam Browser lockdown and lab-network rules, checked on every request." },
  { icon: ScanEye, text: "Live monitoring, extra time per student, and similarity checks after the exam." },
  { icon: ShieldCheck, text: "Self-hosted and open source. Your students' data never leaves your servers." },
];

export default async function Landing() {
  // Signed in? The landing page is for visitors; go straight to work.
  const jar = await cookies();
  if (jar.get(ACCESS_COOKIE) || jar.get(REFRESH_COOKIE)) redirect(homeFor(await requireViewer()));

  return (
    <>
      {/* Hero: the headline, and a bug to fix in one click. */}
      <section className="relative isolate overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-48 -top-72 size-[820px] rounded-full bg-[radial-gradient(closest-side,var(--glow),transparent)]" />
          <div className="absolute -right-56 top-24 size-[760px] rounded-full bg-[radial-gradient(closest-side,var(--glow-2),transparent)]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--line)_1px,transparent_1px),linear-gradient(to_bottom,var(--line)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_30%,black,transparent)]" />
        </div>
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 pb-24 pt-16 sm:pt-24 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          <div className="animate-enter">
            <a
              href="/changelog"
              className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface/70 py-1 pl-1 pr-3 text-[13px] text-ink-muted backdrop-blur transition-colors hover:text-ink"
            >
              <span className="rounded-full bg-ink px-2 py-0.5 text-[12px] font-medium text-canvas">New</span>
              A fresh look, light and dark
            </a>
            <h1 className="display mt-6 max-w-[14ch] text-[3.1rem] text-ink sm:text-[4.2rem] xl:text-[4.6rem]">{SITE.tagline}</h1>
            <p className="mt-6 max-w-[34rem] text-[17px] leading-[1.7] text-ink-muted">
              Coding exams and practice for colleges, built by students. Same exam, same judge, same fair shot for everyone, whichever
              college you&apos;re from.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/login">Sign in to your exams</Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/system-check">Check my laptop</Link>
              </Button>
            </div>
            <p className="mt-8 text-[13px] text-ink-subtle">Open source under the {SITE.license}. Self-hosted by your college.</p>
          </div>
          <div className="animate-enter [animation-delay:120ms]">
            <p className="mb-3 text-[14px] text-ink-muted">Bet you can fix this in one click.</p>
            <BugHunt />
          </div>
        </div>
      </section>

      {/* Numbers */}
      <section aria-label="AetherCode in numbers" className="border-y border-line bg-surface">
        <dl className="mx-auto grid max-w-6xl divide-line px-6 sm:grid-cols-3 sm:divide-x">
          {[
            { value: SITE.stats.students, label: "students have taken exams here" },
            { value: SITE.stats.runs, label: "code runs judged" },
            { value: String(SITE.languages.length), label: "languages, compiled and sandboxed" },
          ].map((stat) => (
            <div key={stat.label} className="py-10 sm:px-10 sm:first:pl-0">
              <dd className="font-serif text-[3.4rem] leading-none tracking-tight text-ink">{stat.value}</dd>
              <dt className="mt-2 text-[14.5px] text-ink-muted">{stat.label}</dt>
            </div>
          ))}
        </dl>
      </section>

      {/* An exam, start to finish: this really is a sequence. */}
      <section className="mx-auto max-w-6xl px-6 py-28">
        <h2 className="display text-[2.6rem] text-ink sm:text-[3.4rem]">What an exam feels like.</h2>
        <ol className="mt-14 grid gap-px overflow-hidden rounded-[var(--radius-surface)] border border-line bg-line md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="bg-canvas p-8">
              <span className="font-mono text-[13px] text-accent">0{index + 1}</span>
              <h3 className="mt-6 text-[19px] font-semibold text-ink">{step.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Two audiences, side by side. */}
      <section className="mx-auto grid max-w-6xl gap-6 px-6 pb-28 lg:grid-cols-2">
        {[
          { title: "For students", lede: "Practice like it counts, because the exam will look exactly the same.", points: STUDENTS },
          { title: "For colleges", lede: "Run fair exams for hundreds of students at once, on your own servers.", points: COLLEGES },
        ].map((column) => (
          <div key={column.title} className="rounded-[var(--radius-surface)] border border-line bg-surface p-8 sm:p-10">
            <h2 className="font-serif text-[2rem] leading-tight text-ink">{column.title}</h2>
            <p className="mt-2 text-[15.5px] leading-relaxed text-ink-muted">{column.lede}</p>
            <ul className="mt-8 space-y-5">
              {column.points.map(({ icon: Icon, text }) => (
                <li key={text} className="flex gap-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-soft-ink">
                    <Icon className="size-4" strokeWidth={1.75} />
                  </span>
                  <span className="pt-1.5 text-[15px] leading-relaxed text-ink">{text}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* Trust, in one line each, with the receipts linked. */}
      <section className="mx-auto max-w-6xl px-6 pb-28">
        <div className="grid gap-10 border-t border-line pt-14 md:grid-cols-3">
          {[
            { href: "/security", title: "Locked down", body: "Row-level security keeps colleges apart; mutual TLS between every service." },
            { href: "/architecture", title: "Sandboxed", body: "Your code runs with no network and hard CPU, memory and time limits." },
            { href: SITE.repo, title: "Open source", body: `Every line is public under the ${SITE.license}. Audit it, host it, improve it.` },
          ].map((item) => (
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

      {/* The one dark moment. */}
      <section className="px-4 pb-24 sm:px-6">
        <div className="relative isolate mx-auto max-w-6xl overflow-hidden rounded-[28px] bg-[#0e141e] px-8 py-20 text-center sm:px-16 sm:py-24">
          <div aria-hidden className="absolute left-1/2 top-0 -z-10 size-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(5_199_112/0.35),transparent)]" />
          <h2 className="display mx-auto max-w-[22ch] text-[2.4rem] text-[#f3f7f7] sm:text-[3.2rem]">Your next placement round is one Submit away.</h2>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="bg-[#05c770] text-[#0e141e] hover:bg-[#1ae689]">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="lg" variant="ghost" className="text-[#c9d3da] hover:bg-white/10 hover:text-white">
              <Link href="/help">How it works</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
