import { ArrowRight, BookOpen, Building2, Check, CircleHelp, Layers, Lock, NotebookPen, PartyPopper, Users, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { type SetupKey, setupSteps } from "@/lib/server/setup";
import { requireStaff } from "@/lib/server/staff";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Get started" };

const META: Record<SetupKey, { icon: LucideIcon; minutes: string; cta: string }> = {
  college: { icon: Building2, minutes: "1 min", cta: "Create college" },
  department: { icon: Layers, minutes: "2 min", cta: "Add department" },
  batch: { icon: Layers, minutes: "1 min", cta: "Add batch" },
  students: { icon: Users, minutes: "5 min", cta: "Enrol students" },
  questions: { icon: BookOpen, minutes: "10 min", cta: "Write questions" },
  exam: { icon: NotebookPen, minutes: "3 min", cta: "Schedule exam" },
};

const RING = 2 * Math.PI * 34;

export default async function GetStartedPage() {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) redirect("/staff");
  const steps = await setupSteps(staff);
  const done = steps.filter((step) => step.done).length;
  const complete = done === steps.length;
  const current = steps.find((step) => !step.done && !step.blocked);
  const percent = Math.round((done / steps.length) * 100);

  return (
    <div className="mx-auto max-w-5xl">
      <section className="relative overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface p-6 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-brand/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="relative size-24 shrink-0">
            <svg viewBox="0 0 80 80" className="size-24 -rotate-90" role="img" aria-label={`${percent} percent complete`}>
              <circle cx="40" cy="40" r="34" fill="none" strokeWidth="6" className="stroke-line" />
              <circle cx="40" cy="40" r="34" fill="none" strokeWidth="6" strokeLinecap="round" className="stroke-brand transition-[stroke-dashoffset] duration-700" strokeDasharray={RING} strokeDashoffset={RING * (1 - done / steps.length)} />
            </svg>
            <span className="absolute inset-0 grid place-items-center text-xl font-semibold tabular-nums text-ink">{percent}%</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-[family-name:var(--font-eyebrow)] text-[10.5px] uppercase tracking-[0.14em] text-ink-subtle">Setup guide</p>
            <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink">{complete ? "You are all set" : "Get your college running"}</h1>
            <p className="mt-1.5 max-w-[60ch] text-sm leading-relaxed text-ink-muted">
              {complete
                ? "Every basic is in place. Add more of anything from its page, or read the guides to go deeper."
                : `${done} of ${steps.length} steps done. Each step needs the one before it, so the order below is the order to work in.`}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {current && (
                <Button asChild>
                  <Link href={current.href}>
                    {META[current.key].cta}
                    <ArrowRight />
                  </Link>
                </Button>
              )}
              <Button asChild variant="secondary">
                <Link href="/staff/help">
                  <CircleHelp />
                  Watch how it works
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <ol className="relative mt-8 space-y-3">
        <span aria-hidden className="absolute bottom-6 left-[27px] top-6 w-px bg-line" />
        {steps.map((step, index) => {
          const { icon: Icon, minutes, cta } = META[step.key];
          const now = step === current;
          return (
            <li key={step.key} className="relative flex gap-4">
              <span
                className={cn(
                  "relative z-10 grid size-14 shrink-0 place-items-center rounded-full border-2 bg-canvas",
                  step.done && "border-brand bg-brand text-brand-ink",
                  now && "border-brand text-brand shadow-[0_0_0_6px_color-mix(in_srgb,var(--color-brand)_14%,transparent)]",
                  !step.done && !now && "border-line text-ink-subtle",
                )}
              >
                {step.done ? <Check className="size-5" strokeWidth={2.5} /> : step.blocked ? <Lock className="size-4" /> : <Icon className="size-5" strokeWidth={1.75} />}
              </span>
              <div className={cn("flex min-w-0 flex-1 flex-col gap-3 rounded-[var(--radius-surface)] border p-4 sm:flex-row sm:items-center", now ? "border-brand/50 bg-surface" : "border-line", step.blocked && "opacity-60")}>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[11px] text-ink-subtle">
                    Step {index + 1} · {step.done ? "Done" : minutes}
                  </p>
                  <h2 className="mt-0.5 text-[15px] font-semibold text-ink">{step.title}</h2>
                  <p className="mt-0.5 text-[13px] text-ink-muted">{step.blocked ?? step.text}</p>
                </div>
                {step.blocked ? (
                  <span className="text-xs text-ink-subtle">Locked</span>
                ) : (
                  <Button asChild size="sm" variant={now ? "primary" : "secondary"}>
                    <Link href={step.href}>
                      {step.done ? "Open" : cta}
                      {!step.done && <ArrowRight />}
                    </Link>
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {complete && (
        <p className="mt-8 flex items-center gap-2 text-sm text-ink-muted">
          <PartyPopper className="size-4 text-brand" />
          Next: invite staff from Staff accounts, or open the Dashboard to watch exams live.
        </p>
      )}
    </div>
  );
}
