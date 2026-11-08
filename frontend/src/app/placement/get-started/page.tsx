import { ArrowRight, Briefcase, ChartBar, Question, Stack, Users } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Panel } from "@/components/ui/card";
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
    <div className="mx-auto max-w-3xl animate-enter">
      <div className="mb-8">
        <p className="font-[family-name:var(--font-eyebrow)] text-[10.5px] uppercase tracking-[0.14em] text-ink-subtle">Welcome</p>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink">Hey {firstName}, here is the placement area</h1>
        <p className="mt-2 text-sm text-ink-muted">Manage placement organisations, assign officers, and track which students are placed where.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {STEPS.map((step) => {
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
