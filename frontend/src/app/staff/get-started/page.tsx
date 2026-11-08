import type { Icon } from "@phosphor-icons/react";
import { ArrowRight, BookOpen, Briefcase, Buildings, ChartBar, Check, Confetti, Lock, NotePencil, Sparkle, Stack, Users } from "@phosphor-icons/react/ssr";
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
  placement: { icon: Briefcase, minutes: "2 min", cta: "Add placement" },
  students: { icon: Users, minutes: "5 min", cta: "Enrol students" },
  questions: { icon: BookOpen, minutes: "10 min", cta: "Write questions" },
  exam: { icon: NotePencil, minutes: "3 min", cta: "Schedule exam" },
};

const FACULTY_STEPS = [
  { icon: BookOpen, title: "Browse questions", text: "All published questions available for exams.", href: "/staff/questions", cta: "Open" },
  { icon: NotePencil, title: "Create an exam", text: "Pick questions, set a window and assign to a batch.", href: "/staff/exams/new", cta: "New exam" },
  { icon: ChartBar, title: "Analytics", text: "Scores and student performance.", href: "/staff/analytics", cta: "Open" },
  { icon: Users, title: "Students", text: "Enrol, import and manage accounts.", href: "/staff/students", cta: "Open" },
];

const RING = 2 * Math.PI * 40;

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

  if (!staff.canManageAccounts || steps.length === 0) {
    return (
      <div className="mx-auto max-w-4xl animate-enter">
        <div className="mb-8 flex items-start gap-4">
          <div className="grid size-12 place-items-center rounded-2xl bg-brand-soft">
            <Sparkle className="size-6 text-brand" />
          </div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-subtle">Welcome back</p>
            <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">{firstName}</h1>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {FACULTY_STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <Link key={step.href} href={step.href} className="group">
                <div
                  className="flex h-full items-center gap-4 rounded-[var(--radius-surface)] border border-line bg-surface px-5 py-4 transition-all duration-150 group-hover:border-brand/30 group-hover:bg-hover"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-hover transition-colors group-hover:bg-brand-soft">
                    <Icon className="size-5 text-ink-muted transition-colors group-hover:text-brand" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] font-medium text-ink">{step.title}</p>
                    <p className="text-[12.5px] text-ink-subtle">{step.text}</p>
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-ink-subtle transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-brand" />
                </div>
              </Link>
            );
          })}
        </div>
        <Link href="/staff/help" className="mt-4 inline-flex items-center gap-2 text-[13px] text-ink-muted transition-colors hover:text-ink">
          <span>Read the guides</span>
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
    );
  }

  const done = steps.filter((step) => step.done).length;
  const complete = done === steps.length;
  const current = steps.find((step) => !step.done && !step.blocked);
  const percent = steps.length ? Math.round((done / steps.length) * 100) : 0;

  return (
    <div className="mx-auto max-w-4xl animate-enter">
      {/* Hero: progress summary */}
      <div className="mb-8 flex flex-col gap-5 rounded-[var(--radius-surface)] border border-line bg-surface p-6 sm:flex-row sm:items-center sm:gap-8">
        {/* Ring */}
        <div className="relative size-24 shrink-0">
          <svg viewBox="0 0 100 100" className="size-24 -rotate-90">
            <circle cx="50" cy="50" r="40" fill="none" strokeWidth="7" className="stroke-line" />
            <circle
              cx="50" cy="50" r="40" fill="none" strokeWidth="7"
              strokeLinecap="round"
              className="stroke-brand transition-[stroke-dashoffset] duration-700"
              strokeDasharray={RING}
              strokeDashoffset={RING * (1 - done / Math.max(steps.length, 1))}
            />
          </svg>
          <span className="absolute inset-0 grid place-items-center font-mono text-[18px] font-bold tabular-nums text-ink">{percent}<span className="text-[11px] text-ink-muted">%</span></span>
        </div>
        {/* Text */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {complete ? <Confetti className="size-5 text-brand" /> : <Sparkle className="size-5 text-brand" />}
            <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-subtle">{complete ? "Complete" : `${done} of ${steps.length} done`}</p>
          </div>
          <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-ink">
            {complete ? `All set, ${firstName}` : `Setting up, ${firstName}`}
          </h1>
          <p className="mt-1 text-[13.5px] text-ink-muted">
            {complete ? "Everything is in place." : "Work through these in order — each step unlocks the next."}
          </p>
          {current && (
            <Button asChild size="sm" className="mt-3">
              <Link href={current.href}>
                {META[current.key].cta}
                <ArrowRight />
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Steps grid */}
      <div className="grid gap-3 sm:grid-cols-2">
        {steps.map((step, index) => {
          const { icon: Icon, cta } = META[step.key];
          const now = step === current;
          return (
            <Link
              key={step.key}
              href={step.href}
              className={cn("group", step.blocked && "pointer-events-none")}
            >
              <div className={cn(
                "flex h-full items-start gap-4 rounded-[var(--radius-surface)] border px-5 py-4 transition-all duration-150",
                now ? "border-brand/40 bg-brand-soft/20 group-hover:bg-brand-soft/30" : "border-line bg-surface group-hover:border-brand/20 group-hover:bg-hover",
                step.blocked && "opacity-40",
              )}>
                <div className={cn(
                  "mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg transition-colors",
                  step.done ? "bg-brand text-brand-ink" : now ? "bg-brand-soft" : "bg-hover group-hover:bg-brand-soft",
                )}>
                  {step.done ? (
                    <Check className="size-4" />
                  ) : step.blocked ? (
                    <Lock className="size-3.5 text-ink-subtle" />
                  ) : (
                    <Icon className={cn("size-4", now ? "text-brand" : "text-ink-muted group-hover:text-brand")} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn("text-[14.5px] font-medium", step.done ? "text-ink" : now ? "text-ink" : "text-ink")}>{step.title}</p>
                    {step.done && <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 font-mono text-[10px] font-bold text-brand">Done</span>}
                    {now && !step.done && <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 font-mono text-[10px] font-bold text-brand-ink">Next</span>}
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-ink-subtle">{step.text}</p>
                  {!step.blocked && (
                    <span className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-brand">
                      {step.done ? "Open" : cta}
                      <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {complete && (
        <p className="mt-6 flex items-center gap-2 text-[13px] text-ink-muted">
          <Confetti className="size-4 text-brand" />
          Go to Dashboard to watch exams live, or invite staff from Staff accounts.
        </p>
      )}
    </div>
  );
}
