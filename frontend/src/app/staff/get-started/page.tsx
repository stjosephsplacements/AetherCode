import type { Icon } from "@phosphor-icons/react";
import { ArrowRight, BookOpen, Briefcase, Buildings, ChartBar, Check, Confetti, Lock, NotePencil, Question, Stack, Users } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { type SetupKey, setupSteps } from "@/lib/server/setup";
import { requireStaff } from "@/lib/server/staff";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Get started" };

const META: Record<SetupKey, { icon: Icon; minutes: string; cta: string }> = {
  college: { icon: Buildings, minutes: "1 min", cta: "Create college" },
  department: { icon: Stack, minutes: "2 min", cta: "Add department" },
  batch: { icon: Stack, minutes: "1 min", cta: "Add batch" },
  placement: { icon: Briefcase, minutes: "2 min", cta: "Add placement department" },
  students: { icon: Users, minutes: "5 min", cta: "Enrol students" },
  questions: { icon: BookOpen, minutes: "10 min", cta: "Write questions" },
  exam: { icon: NotePencil, minutes: "3 min", cta: "Schedule exam" },
};

const RING = 2 * Math.PI * 34;

export default async function GetStartedPage() {
  const staff = await requireStaff();
  let steps;
  try {
    steps = staff.canManageAccounts ? await setupSteps(staff) : [];
  } catch (error) {
    return (
      <>
        <PageHeader title="Get started" />
        <LoadError error={error} />
      </>
    );
  }
  const firstName = staff.viewer.displayName.split(" ")[0] || staff.viewer.username;

  // Non-admin staff (faculty, mentors) see a simple quick-start card grid.
  if (!staff.canManageAccounts || steps.length === 0) {
    const FACULTY_STEPS = [
      { icon: Question, title: "Write a question", text: "Start in the question bank. Add a prompt, tests and a model solution.", href: "/staff/questions/new", cta: "New question" },
      { icon: BookOpen, title: "Browse questions", text: "See all published questions available for exams.", href: "/staff/questions", cta: "Question bank" },
      { icon: NotePencil, title: "Create an exam", text: "Pick questions, set a window and duration, then assign to a batch.", href: "/staff/exams/new", cta: "New exam" },
      { icon: ChartBar, title: "View analytics", text: "Scores, pass rates and student performance for this college.", href: "/staff/analytics", cta: "Analytics" },
      { icon: Users, title: "Manage students", text: "Enrol, import and manage student accounts.", href: "/staff/students", cta: "Students" },
    ];
    return (
      <div className="mx-auto max-w-3xl animate-enter">
        <div className="mb-8">
          <p className="font-[family-name:var(--font-eyebrow)] text-[10.5px] uppercase tracking-[0.14em] text-ink-subtle">Welcome</p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink">Hey {firstName}, here is where to start</h1>
          <p className="mt-2 text-sm text-ink-muted">Quick links to the things you use most.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {FACULTY_STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <Link key={step.href} href={step.href} className="group">
                <Panel className="flex h-full flex-col gap-3 p-5 transition-shadow group-hover:shadow-[var(--shadow-panel)]">
                  <Icon className="size-6 text-brand" />
                  <div>
                    <p className="text-[15px] font-semibold text-ink">{step.title}</p>
                    <p className="mt-1 text-[13px] leading-snug text-ink-muted">{step.text}</p>
                  </div>
                  <span className="mt-auto inline-flex items-center gap-1 text-[13px] font-medium text-brand">
                    {step.cta} <ArrowRight className="size-3.5" />
                  </span>
                </Panel>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  const done = steps.filter((step) => step.done).length;
  const complete = done === steps.length;
  const current = steps.find((step) => !step.done && !step.blocked);
  const percent = steps.length ? Math.round((done / steps.length) * 100) : 0;

  return (
    <div className="mx-auto max-w-3xl animate-enter">
      <div className="mb-8 flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className="relative size-24 shrink-0">
          <svg viewBox="0 0 80 80" className="size-24 -rotate-90" role="img" aria-label={`${percent}% complete`}>
            <circle cx="40" cy="40" r="34" fill="none" strokeWidth="6" className="stroke-line" />
            <circle cx="40" cy="40" r="34" fill="none" strokeWidth="6" strokeLinecap="round" className="stroke-brand transition-[stroke-dashoffset] duration-700" strokeDasharray={RING} strokeDashoffset={RING * (1 - done / Math.max(steps.length, 1))} />
          </svg>
          <span className="absolute inset-0 grid place-items-center text-xl font-semibold tabular-nums text-ink">{percent}%</span>
        </div>
        <div>
          <p className="font-[family-name:var(--font-eyebrow)] text-[10.5px] uppercase tracking-[0.14em] text-ink-subtle">Setup</p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink">{complete ? "All set" : `${done} of ${steps.length} done`}</h1>
          <p className="mt-1.5 text-sm text-ink-muted">{complete ? "Everything is in place. Add more from any page." : "Work through these in order. Each step unlocks the next."}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {steps.map((step) => {
          const { icon: Icon, cta } = META[step.key];
          const now = step === current;
          return (
            <Link key={step.key} href={step.href} className={cn("group", step.blocked && "pointer-events-none opacity-50")}>
              <Panel className={cn("flex h-full flex-col gap-3 p-5 transition-shadow group-hover:shadow-[var(--shadow-panel)]", now && "ring-2 ring-brand/30")}>
                <div className="flex items-center justify-between">
                  {step.done ? <Check className="size-6 text-brand" /> : step.blocked ? <Lock className="size-5 text-ink-subtle" /> : <Icon className="size-6 text-brand" />}
                  {step.done && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">Done</span>}
                  {now && <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-medium text-brand-ink">Next</span>}
                </div>
                <div>
                  <p className="text-[15px] font-semibold text-ink">{step.title}</p>
                  <p className="mt-1 text-[13px] leading-snug text-ink-muted">{step.text}</p>
                </div>
                {!step.blocked && (
                  <span className="mt-auto inline-flex items-center gap-1 text-[13px] font-medium text-brand">
                    {step.done ? "Open" : cta} <ArrowRight className="size-3.5" />
                  </span>
                )}
              </Panel>
            </Link>
          );
        })}
      </div>

      {complete && (
        <p className="mt-6 flex items-center gap-2 text-sm text-ink-muted">
          <Confetti className="size-4 text-brand" />
          Next: invite staff from Staff accounts, or open the Dashboard to watch exams live.
        </p>
      )}
    </div>
  );
}
