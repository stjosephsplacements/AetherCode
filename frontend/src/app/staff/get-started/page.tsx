import type { Icon } from "@phosphor-icons/react";
import { ArrowRight, BookOpen, Briefcase, Buildings, ChartBar, Check, Confetti, Lock, NotePencil, Stack, Users } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { Ring } from "@/components/student/ring";
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
      <div className="mx-auto max-w-3xl animate-enter">
        {/* Poster-sky hero */}
        <div className="mb-8 overflow-hidden rounded-3xl p-8" style={{ background: "var(--poster-sky)" }}>
          <p className="font-[family-name:var(--font-eyebrow)] text-[10.5px] uppercase tracking-[0.16em] text-white/60">Welcome back</p>
          <h1 className="mt-2 text-[32px] font-semibold leading-tight tracking-[-0.03em] text-white">{firstName}</h1>
          <p className="mt-1.5 text-[14px] text-white/70">Here is what you can do today.</p>
        </div>

        {/* Numbered vertical list */}
        <ol className="space-y-0">
          {FACULTY_STEPS.map((step, i) => {
            const Icon = step.icon;
            const num = String(i + 1).padStart(2, "0");
            const last = i === FACULTY_STEPS.length - 1;
            return (
              <li key={step.href} className="flex gap-5" style={{ animationDelay: `${i * 60}ms`, animation: "var(--animate-enter)" }}>
                {/* Number + connector */}
                <div className="flex flex-col items-center">
                  <div className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-line bg-surface">
                    <span className="font-[family-name:var(--font-eyebrow)] text-[11px] font-bold text-ink-muted">{num}</span>
                  </div>
                  {!last && <div className="my-1 w-px flex-1 border-l border-dashed border-line" />}
                </div>
                {/* Card */}
                <Link href={step.href} className="group mb-4 min-w-0 flex-1">
                  <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface px-5 py-4 transition-all duration-150 group-hover:border-brand/30 group-hover:bg-hover">
                    <div className="liquid-glass grid size-10 shrink-0 place-items-center rounded-xl transition-colors group-hover:bg-brand-soft">
                      <Icon className="size-5 text-ink-muted transition-colors group-hover:text-brand" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14.5px] font-medium text-ink">{step.title}</p>
                      <p className="text-[12.5px] text-ink-subtle">{step.text}</p>
                    </div>
                    <span className="shrink-0 text-[12.5px] font-medium text-brand opacity-0 transition-opacity group-hover:opacity-100">{step.cta}</span>
                    <ArrowRight className="size-4 shrink-0 text-ink-subtle transition-all group-hover:translate-x-0.5 group-hover:text-brand" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>

        <Link href="/staff/help" className="mt-2 inline-flex items-center gap-2 text-[13px] text-ink-muted transition-colors hover:text-ink">
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
    <div className="mx-auto max-w-3xl animate-enter">
      {/* Poster-sky hero with Ring */}
      <div className="mb-8 overflow-hidden rounded-3xl p-8" style={{ background: "var(--poster-sky)" }}>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-8">
          <Ring value={done} max={steps.length} size={88} stroke={8} barClass="stroke-white" trackClass="stroke-white/20">
            <span className="font-[family-name:var(--font-eyebrow)] text-[16px] font-bold text-white">{percent}<span className="text-[10px] text-white/70">%</span></span>
          </Ring>
          <div className="min-w-0 flex-1">
            <p className="font-[family-name:var(--font-eyebrow)] text-[10.5px] uppercase tracking-[0.16em] text-white/60">
              {complete ? "Complete" : `${done} of ${steps.length} done`}
            </p>
            <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-[-0.025em] text-white">
              {complete ? `All set, ${firstName}` : `Setting up, ${firstName}`}
            </h1>
            <p className="mt-1 text-[13.5px] text-white/70">
              {complete ? "Everything is in place. Go run some exams." : "Work through these in order — each one unlocks the next."}
            </p>
            {current && (
              <Button asChild size="sm" variant="secondary" className="mt-4 border-white/20 bg-white/15 text-white hover:bg-white/25">
                <Link href={current.href}>
                  {META[current.key].cta}
                  <ArrowRight />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Vertical timeline */}
      <ol className="space-y-0">
        {steps.map((step, i) => {
          const { icon: Icon, cta } = META[step.key];
          const now = step === current;
          const last = i === steps.length - 1;
          return (
            <li key={step.key} className="flex gap-4" style={{ animationDelay: `${i * 50}ms`, animation: "var(--animate-enter)" }}>
              {/* Timeline spine */}
              <div className="flex flex-col items-center">
                <div className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-full border-2 transition-colors",
                  step.done ? "border-brand bg-brand text-brand-ink" : now ? "border-brand bg-brand-soft" : "border-line bg-surface",
                )}>
                  {step.done ? (
                    <Check className="size-4" />
                  ) : step.blocked ? (
                    <Lock className="size-3.5 text-ink-subtle" />
                  ) : (
                    <Icon className={cn("size-4", now ? "text-brand" : "text-ink-muted")} />
                  )}
                </div>
                {!last && <div className="my-1 w-px flex-1 border-l border-dashed border-line" />}
              </div>
              {/* Step card */}
              <Link
                href={step.href}
                className={cn("group mb-4 min-w-0 flex-1", step.blocked && "pointer-events-none")}
              >
                <div className={cn(
                  "liquid-glass flex h-full items-start gap-4 rounded-2xl border px-5 py-4 transition-all duration-150",
                  now ? "border-brand/40 group-hover:bg-brand-soft/10" : "border-line group-hover:border-brand/20",
                  step.blocked && "opacity-40",
                )}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[14.5px] font-semibold text-ink">{step.title}</p>
                      {step.done && (
                        <span className="rounded-full bg-brand px-2.5 py-0.5 font-[family-name:var(--font-eyebrow)] text-[9px] uppercase tracking-wider text-brand-ink">Done</span>
                      )}
                      {now && !step.done && (
                        <span className="rounded-full bg-brand/15 px-2.5 py-0.5 font-[family-name:var(--font-eyebrow)] text-[9px] uppercase tracking-wider text-brand">Next</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[12.5px] text-ink-subtle">{step.text}</p>
                    {!step.blocked && (
                      <span className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-brand">
                        {step.done ? "Open" : cta}
                        <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 font-[family-name:var(--font-eyebrow)] text-[10px] text-ink-subtle">{META[step.key].minutes}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ol>

      {complete && (
        <p className="mt-2 flex items-center gap-2 text-[13px] text-ink-muted">
          <Confetti className="size-4 text-brand" />
          Go to Dashboard to watch exams live, or invite staff from Staff accounts.
        </p>
      )}
    </div>
  );
}
