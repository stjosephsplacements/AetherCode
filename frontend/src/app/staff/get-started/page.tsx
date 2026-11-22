import type { Icon } from "@phosphor-icons/react";
import { ArrowRight, BookOpen, Briefcase, Buildings, ChartBar, CheckCircle, Confetti, Lock, NotePencil, Question, Rocket, Stack, Users } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { panel } from "@/app/admin/_dashboard/panel";
import { Button } from "@/components/ui/button";
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
] as const;

const DAY_TO_DAY = [
  { icon: ChartBar, title: "Dashboard", text: "Live exams, queue health and recent activity.", href: "/staff", cta: "Open" },
  { icon: Question, title: "Help", text: "Guides for enrolment, exams and results.", href: "/staff/help", cta: "Read guides" },
] as const;

type Row = {
  key: string;
  title: string;
  text: string;
  href: string;
  cta: string;
  done: boolean;
  blocked?: boolean;
  next?: boolean;
  meta?: string;
  Icon: Icon;
};

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
    const next = FACULTY_STEPS[0]!;
    return (
      <div className="animate-enter">
        <PageHeader
          title={`Get started, ${firstName}`}
          description="Shortcuts for the work you do most — questions, exams, analytics and students."
          actions={
            <Button asChild>
              <Link href={next.href}>
                {next.cta}
                <ArrowRight />
              </Link>
            </Button>
          }
        />

        <div className="grid gap-3 md:grid-cols-6 xl:grid-cols-12">
          <section className={cn(panel, "md:col-span-6 xl:col-span-5")}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Faculty console</p>
                <p className="mt-3 text-[18px] font-semibold tracking-[-0.02em] text-ink">Ready when you are</p>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
                  No setup checklist for your role — jump straight into authoring and monitoring.
                </p>
              </div>
              <span className="grid size-10 place-items-center rounded-control bg-brand/15 text-brand">
                <Rocket className="size-5" weight="fill" />
              </span>
            </div>
          </section>

          <section className={cn(panel, "md:col-span-6 xl:col-span-7")}>
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Up next</p>
            <div className="mt-4 flex flex-1 flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-ink">
                  <next.icon className="size-5 shrink-0 text-brand" />
                  {next.title}
                </p>
                <p className="mt-2 max-w-[48ch] text-[13.5px] leading-relaxed text-ink-muted">{next.text}</p>
              </div>
              <Button asChild className="shrink-0">
                <Link href={next.href}>
                  {next.cta}
                  <ArrowRight />
                </Link>
              </Button>
            </div>
          </section>

          <section className={cn(panel, "md:col-span-6 xl:col-span-7")}>
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">What you can do</h2>
              <p className="text-[12.5px] text-ink-muted">{FACULTY_STEPS.length} shortcuts</p>
            </div>
            <ol className="space-y-2">
              {FACULTY_STEPS.map((step, index) => (
                <StepRow
                  key={step.href}
                  step={{
                    key: step.href,
                    title: step.title,
                    text: step.text,
                    href: step.href,
                    cta: step.cta,
                    done: false,
                    Icon: step.icon,
                  }}
                  index={index}
                />
              ))}
            </ol>
          </section>

          <section className={cn(panel, "md:col-span-6 xl:col-span-5")}>
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Day to day</h2>
              <p className="text-[12.5px] text-ink-muted">Always available</p>
            </div>
            <ul className="space-y-2">
              {DAY_TO_DAY.map((step, index) => (
                <StepRow
                  key={step.href}
                  step={{
                    key: step.href,
                    title: step.title,
                    text: step.text,
                    href: step.href,
                    cta: step.cta,
                    done: false,
                    Icon: step.icon,
                  }}
                  index={index}
                />
              ))}
            </ul>
          </section>
        </div>
      </div>
    );
  }

  const done = steps.filter((step) => step.done).length;
  const complete = done === steps.length;
  const current = steps.find((step) => !step.done && !step.blocked);
  const percent = steps.length ? Math.round((done / steps.length) * 100) : 0;
  const nextMeta = current ? META[current.key] : null;
  const rows: Row[] = steps.map((step) => {
    const meta = META[step.key];
    return {
      key: step.key,
      title: step.title,
      text: step.blocked ?? step.text,
      href: step.href,
      cta: step.done ? "Open" : meta.cta,
      done: step.done,
      blocked: Boolean(step.blocked),
      next: step === current,
      meta: meta.minutes,
      Icon: meta.icon,
    };
  });

  return (
    <div className="animate-enter">
      <PageHeader
        title={complete ? `All set, ${firstName}` : `Get started, ${firstName}`}
        description={
          complete
            ? "Everything is in place. Run exams from the dashboard or invite staff from Staff accounts."
            : "Work through these in order — each step unlocks the next."
        }
        actions={
          <Button asChild>
            <Link href={current?.href ?? "/staff"}>
              {complete ? "Open dashboard" : nextMeta?.cta ?? "Continue"}
              <ArrowRight />
            </Link>
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-6 xl:grid-cols-12">
        <section className={cn(panel, "md:col-span-6 xl:col-span-5")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Setup progress</p>
              <p className="mt-3 font-mono text-[2.5rem] font-semibold leading-none tracking-[-0.03em] tabular-nums text-ink">
                {percent}
                <span className="text-[1rem] text-ink-muted">%</span>
              </p>
              <p className="mt-2 text-[13px] text-ink-muted">
                {done} of {steps.length} steps done
              </p>
            </div>
            <span className={cn("grid size-10 place-items-center rounded-control", complete ? "bg-success/15 text-success" : "bg-brand/15 text-brand")}>
              {complete ? <CheckCircle className="size-5" weight="fill" /> : <Rocket className="size-5" weight="fill" />}
            </span>
          </div>
          <div className="mt-5 h-2.5 overflow-hidden rounded-pill bg-hover" role="img" aria-label={`${percent} percent complete`}>
            <span className={cn("block h-full rounded-pill", complete ? "bg-success" : "bg-brand")} style={{ width: `${percent}%` }} />
          </div>
          {complete && (
            <p className="mt-4 flex items-center gap-2 text-[13px] text-ink-muted">
              <Confetti className="size-4 text-brand" />
              College basics are ready.
            </p>
          )}
        </section>

        <section className={cn(panel, "md:col-span-6 xl:col-span-7")}>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">{complete ? "Ready" : "Up next"}</p>
          <div className="mt-4 flex flex-1 flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-ink">
                {complete ? (
                  <CheckCircle className="size-5 shrink-0 text-success" weight="fill" />
                ) : nextMeta ? (
                  <nextMeta.icon className="size-5 shrink-0 text-brand" />
                ) : null}
                {complete ? "College is ready to run" : current?.title}
              </p>
              <p className="mt-2 max-w-[48ch] text-[13.5px] leading-relaxed text-ink-muted">
                {complete
                  ? "Open the dashboard to watch exams live, or invite staff from Staff accounts."
                  : current?.text}
              </p>
            </div>
            <Button asChild variant={complete ? "secondary" : "primary"} className="shrink-0">
              <Link href={current?.href ?? "/staff"}>
                {complete ? "Open dashboard" : nextMeta?.cta ?? "Continue"}
                <ArrowRight />
              </Link>
            </Button>
          </div>
        </section>

        <section className={cn(panel, "md:col-span-6 xl:col-span-7")}>
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Setup checklist</h2>
            <p className="text-[12.5px] text-ink-muted">
              {done}/{steps.length} complete
            </p>
          </div>
          <ol className="space-y-2">
            {rows.map((step, index) => (
              <StepRow key={step.key} step={step} index={index} />
            ))}
          </ol>
        </section>

        <section className={cn(panel, "md:col-span-6 xl:col-span-5")}>
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Day to day</h2>
            <p className="text-[12.5px] text-ink-muted">Always available</p>
          </div>
          <ul className="space-y-2">
            {DAY_TO_DAY.map((step, index) => (
              <StepRow
                key={step.href}
                step={{
                  key: step.href,
                  title: step.title,
                  text: step.text,
                  href: step.href,
                  cta: step.cta,
                  done: false,
                  Icon: step.icon,
                }}
                index={index}
              />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function StepRow({ step, index }: { step: Row; index: number }) {
  const Icon = step.Icon;
  return (
    <li>
      <Link
        href={step.href}
        className={cn(
          "group flex items-start gap-3 rounded-control border border-line bg-hover/30 px-3 py-3 transition-colors hover:bg-hover sm:gap-3.5 sm:px-3.5",
          step.blocked && "pointer-events-none opacity-40",
          step.next && "border-brand/40 bg-brand-soft/20",
        )}
      >
        <span
          className={cn(
            "mt-0.5 grid size-8 shrink-0 place-items-center rounded-control",
            step.done ? "bg-success/15 text-success" : step.next ? "bg-brand/15 text-brand" : "bg-surface text-ink-muted ring-1 ring-line-strong",
          )}
          aria-hidden
        >
          {step.done ? <CheckCircle className="size-4" weight="fill" /> : step.blocked ? <Lock className="size-3.5" /> : <Icon className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10.5px] tabular-nums text-ink-subtle">{String(index + 1).padStart(2, "0")}</span>
            <span className="text-[14px] font-semibold text-ink">{step.title}</span>
            {step.done && <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-success">Done</span>}
            {step.next && !step.done && <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-brand">Next</span>}
            {step.meta && <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-subtle">{step.meta}</span>}
          </span>
          <span className="mt-1 block text-[12.5px] leading-snug text-ink-muted">{step.text}</span>
        </span>
        {!step.blocked && (
          <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-brand">
            {step.cta}
            <ArrowRight className="size-3.5 opacity-70 transition-transform group-hover:translate-x-0.5" />
          </span>
        )}
      </Link>
    </li>
  );
}
