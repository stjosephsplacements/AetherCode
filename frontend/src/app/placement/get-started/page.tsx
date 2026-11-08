import { ArrowRight, Briefcase, ChartBar, Question, Stack, Users } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePlacement } from "@/lib/server/placement";

export const metadata: Metadata = { title: "Get started" };

const STEPS = [
  {
    icon: Stack,
    title: "Set up placement departments",
    text: "Create your placement organisation (e.g. SJPTC), then add tracks like ELITE, HOPE, PEP under it.",
    href: "/placement/departments",
    cta: "Departments",
  },
  {
    icon: Users,
    title: "Assign placement officers",
    text: "Pick existing staff members and assign them to placement departments.",
    href: "/placement/staff",
    cta: "Officers",
  },
  {
    icon: Briefcase,
    title: "View student placements",
    text: "See which students are in each track, filter by college or batch, and export to CSV.",
    href: "/placement",
    cta: "Placements",
  },
  {
    icon: Question,
    title: "Browse the question bank",
    text: "All questions shared across colleges. See what's available for placement exams.",
    href: "/placement/questions",
    cta: "Questions",
  },
  {
    icon: ChartBar,
    title: "Check exams across colleges",
    text: "Published and draft exams from every college in one view.",
    href: "/placement/exams",
    cta: "Exams",
  },
];

export default async function PlacementGetStarted() {
  const placement = await requirePlacement();
  const firstName = placement.viewer.displayName.split(" ")[0] || placement.viewer.username;

  return (
    <div className="mx-auto max-w-2xl animate-enter">
      {/* Hero */}
      <div className="mb-10 overflow-hidden rounded-3xl" style={{ background: "var(--poster-sky)" }}>
        <div className="px-7 py-8" style={{ background: "var(--horizon)" }}>
          <p className="font-[family-name:var(--font-eyebrow)] text-[10px] uppercase tracking-[0.18em] text-white/60">Placement console</p>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.025em] text-white">
            Hey {firstName}
          </h1>
          <p className="mt-1.5 text-[14px] leading-relaxed text-white/70">
            Manage organisations, assign officers, and track students across every college.
          </p>
        </div>
      </div>

      {/* Vertical timeline */}
      <ol className="relative space-y-0">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          const last = i === STEPS.length - 1;
          return (
            <li
              key={step.href}
              className="animate-enter flex gap-5"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              {/* Spine */}
              <div className="flex flex-col items-center">
                <div className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-surface shadow-[var(--shadow-hairline)]">
                  <Icon className="size-4 text-brand" />
                </div>
                {!last && <div className="my-1 w-px flex-1 border-l border-dashed border-line" />}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1 pb-8">
                <p className="font-[family-name:var(--font-eyebrow)] text-[10px] tracking-[0.12em] text-ink-subtle opacity-50">
                  {String(i + 1).padStart(2, "0")}
                </p>
                <p className="mt-0.5 text-[15px] font-semibold text-ink">{step.title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{step.text}</p>
                <Link
                  href={step.href}
                  className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand transition-opacity hover:opacity-75"
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
