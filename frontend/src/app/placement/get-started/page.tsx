import { ArrowRight, Briefcase, ChartBar, NotePencil, Question, Users } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePlacement } from "@/lib/server/placement";

export const metadata: Metadata = { title: "Get started" };

const STEPS = [
  {
    icon: Users,
    title: "Assign students to your track",
    text: "Select students already enrolled in a college and map them into your placement department. You do not create accounts.",
    href: "/placement/students",
    cta: "Students",
  },
  {
    icon: Briefcase,
    title: "Review placements",
    text: "See who is in each track you manage, filter by college or batch, and export to CSV.",
    href: "/placement",
    cta: "Placements",
  },
  {
    icon: Question,
    title: "Author questions",
    text: "Write drafts in the shared bank for placement exams.",
    href: "/placement/questions/new",
    cta: "New question",
  },
  {
    icon: NotePencil,
    title: "Run placement exams",
    text: "Create an exam under a host college, then assign it to your tracks.",
    href: "/placement/exams/new",
    cta: "New exam",
  },
  {
    icon: ChartBar,
    title: "Check analytics",
    text: "How many students sit in each track across the colleges you reach.",
    href: "/placement/analytics",
    cta: "Analytics",
  },
];

export default async function PlacementGetStarted() {
  const placement = await requirePlacement();
  const firstName = placement.viewer.displayName.split(" ")[0] || placement.viewer.username;
  const tracks =
    placement.departmentIds.length === 0
      ? "Ask a platform administrator to assign you a placement department."
      : placement.departmentIds.length === 1
        ? "You work in one assigned placement department."
        : `You work across ${placement.departmentIds.length} assigned placement departments.`;

  return (
    <div className="mx-auto max-w-2xl animate-enter">
      <div className="mb-10 overflow-hidden rounded-panel" style={{ background: "var(--poster-sky)" }}>
        <div className="px-7 py-8" style={{ background: "var(--horizon)" }}>
          <p className="font-[family-name:var(--font-eyebrow)] text-[10px] uppercase tracking-[0.18em] text-white/60">Placement console</p>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.025em] text-white">Hey {firstName}</h1>
          <p className="mt-1.5 text-[14px] leading-relaxed text-white/70">{tracks}</p>
        </div>
      </div>

      <ol className="relative space-y-0">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          const last = i === STEPS.length - 1;
          return (
            <li key={step.href} className="animate-enter flex gap-5" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="flex flex-col items-center">
                <div className="grid size-10 shrink-0 place-items-center rounded-pill border border-line bg-surface shadow-[var(--shadow-hairline)]">
                  <Icon className="size-4 text-brand" />
                </div>
                {!last && <div className="my-1 w-px flex-1 bg-line" />}
              </div>
              <div className={`min-w-0 flex-1 ${last ? "pb-0" : "pb-8"}`}>
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{step.title}</h2>
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">{step.text}</p>
                <Link
                  href={step.href}
                  className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline"
                >
                  {step.cta}
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
