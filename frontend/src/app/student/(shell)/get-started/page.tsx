import { ArrowRight, BookOpenText, Code, FileText, Laptop, Trophy, UserCircle } from "@phosphor-icons/react/ssr";
import type { Icon } from "@phosphor-icons/react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireViewer } from "@/lib/server/session";

export const metadata: Metadata = { title: "Get started" };

const STEPS: { icon: Icon; title: string; text: string; href: string; cta: string }[] = [
  {
    icon: Laptop,
    title: "Check your setup",
    text: "Make sure your browser and network are ready for exams.",
    href: "/system-check",
    cta: "Run system check",
  },
  {
    icon: BookOpenText,
    title: "Try a practice problem",
    text: "Write code, run it against sample tests, then submit. Nothing here counts for exams.",
    href: "/student/practice",
    cta: "Open practice",
  },
  {
    icon: Code,
    title: "See your exams",
    text: "Your assigned exams show here with their time window and duration.",
    href: "/student/exams",
    cta: "My exams",
  },
  {
    icon: Trophy,
    title: "Track your performance",
    text: "Scores, streaks and practice progress in one place.",
    href: "/student/performance",
    cta: "Performance",
  },
  {
    icon: UserCircle,
    title: "Set up your profile",
    text: "Link your coding accounts (LeetCode, GitHub) to show your numbers here.",
    href: "/student/profile",
    cta: "My profile",
  },
  {
    icon: FileText,
    title: "Read the help page",
    text: "Answers to what students ask most during exams.",
    href: "/student/help",
    cta: "Help",
  },
];

export default async function StudentGetStarted() {
  const viewer = await requireViewer();
  const firstName = viewer.displayName.split(" ")[0] || viewer.username;

  return (
    <div className="mx-auto max-w-4xl">
      {/* Hero */}
      <div className="mb-10 overflow-hidden rounded-3xl bg-gradient-to-br from-[#1b1640] via-[#5a210d] to-[#b84a0d] px-8 py-10 animate-enter">
        <p className="font-[family-name:var(--font-eyebrow)] text-[10px] uppercase tracking-[0.18em] text-white/60">
          Welcome
        </p>
        <h1 className="mt-2 text-[32px] font-semibold leading-tight tracking-[-0.025em] text-white">
          Hey {firstName}
        </h1>
        <p className="mt-2 max-w-md text-[14px] leading-relaxed text-white/70">
          Six things to do before your first exam. Follow them in order and you will be set.
        </p>
      </div>

      {/* Desktop: horizontal numbered track */}
      <div className="hidden lg:block">
        {/* Connector line behind the circles */}
        <div className="relative px-6">
          <div className="absolute left-[calc(100%/12)] right-[calc(100%/12)] top-5 h-px bg-line" />
          <div className="relative grid grid-cols-6 gap-2">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <Link
                  key={step.href}
                  href={step.href}
                  className="group flex flex-col items-center text-center"
                  style={{ animationDelay: `${i * 60}ms`, animation: "var(--animate-enter)" }}
                >
                  {/* Numbered circle */}
                  <div className="relative z-10 mb-4 grid size-10 place-items-center rounded-full border-2 border-line bg-surface text-[13px] font-semibold tabular-nums text-ink-muted transition-all duration-200 group-hover:border-brand group-hover:bg-brand group-hover:text-brand-ink">
                    {i + 1}
                  </div>
                  {/* Icon box */}
                  <div className="mb-3 grid size-10 place-items-center rounded-xl bg-hover text-ink-muted transition-colors group-hover:bg-brand-soft group-hover:text-brand">
                    <Icon className="size-5" />
                  </div>
                  <p className="text-[13px] font-semibold leading-snug text-ink">{step.title}</p>
                  <p className="mt-1 text-[11.5px] leading-snug text-ink-subtle">{step.text}</p>
                  <span className="mt-2 inline-flex items-center gap-0.5 text-[12px] font-medium text-brand opacity-0 transition-opacity group-hover:opacity-100">
                    {step.cta} <ArrowRight className="size-3" />
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Mobile: vertical timeline */}
      <div className="lg:hidden">
        <div className="relative pl-10">
          {/* Vertical line */}
          <div className="absolute bottom-4 left-4 top-4 w-px bg-line" />
          <div className="space-y-2">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <Link
                  key={step.href}
                  href={step.href}
                  className="group relative flex items-start gap-4 rounded-2xl border border-line bg-surface px-4 py-3.5 transition-all hover:border-brand/30 hover:bg-hover"
                  style={{ animationDelay: `${i * 60}ms`, animation: "var(--animate-enter)" }}
                >
                  {/* Step number bubble — sits on the vertical line */}
                  <div className="absolute -left-[18px] top-4 z-10 grid size-8 place-items-center rounded-full border-2 border-line bg-surface text-[11px] font-semibold tabular-nums text-ink-muted transition-colors group-hover:border-brand group-hover:text-brand">
                    {i + 1}
                  </div>
                  <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-hover text-ink-muted transition-colors group-hover:bg-brand-soft group-hover:text-brand">
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-ink">{step.title}</p>
                    <p className="mt-0.5 text-[12.5px] leading-snug text-ink-muted">{step.text}</p>
                  </div>
                  <ArrowRight className="mt-1 size-4 shrink-0 text-ink-subtle transition-all group-hover:translate-x-0.5 group-hover:text-brand" />
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
