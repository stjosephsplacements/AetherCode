import { ArrowRight, Buildings, ChartBar, Gear, Shield, Users, Warning } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Panel } from "@/components/ui/card";
import { requireAdmin } from "@/lib/server/staff";

export const metadata: Metadata = { title: "Get started" };

const STEPS = [
  {
    icon: Buildings,
    title: "Create a college",
    text: "Everything starts here. A college holds departments, batches, staff and students.",
    href: "/admin/colleges",
    cta: "Colleges",
  },
  {
    icon: Users,
    title: "Add administrators",
    text: "Give platform-wide access to trusted staff. Narrow their permissions after.",
    href: "/admin/admins",
    cta: "Administrators",
  },
  {
    icon: Gear,
    title: "Set up placement",
    text: "Create placement organisations (like SJPTC) and their tracks (ELITE, HOPE, PEP).",
    href: "/placement/departments",
    cta: "Placement departments",
  },
  {
    icon: Warning,
    title: "Watch for incidents",
    text: "Problems across all colleges show here. The page updates live.",
    href: "/admin/incidents",
    cta: "Incidents",
  },
  {
    icon: ChartBar,
    title: "Monitor services",
    text: "CPU, memory and request rates from Prometheus, updated every 10 seconds.",
    href: "/admin/analytics",
    cta: "Analytics",
  },
  {
    icon: Shield,
    title: "Review the audit log",
    text: "Every change staff made, across all colleges. Open a college first to see its log.",
    href: "/admin/audit",
    cta: "Audit log",
  },
];

export default async function AdminGetStarted() {
  const staff = await requireAdmin();
  const firstName = staff.viewer.displayName.split(" ")[0] || staff.viewer.username;

  return (
    <div className="mx-auto max-w-3xl animate-enter">
      <div className="mb-8">
        <p className="font-[family-name:var(--font-eyebrow)] text-[10.5px] uppercase tracking-[0.14em] text-ink-subtle">Welcome</p>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink">Hey {firstName}, here is the admin console</h1>
        <p className="mt-2 text-sm text-ink-muted">Set up colleges, manage administrators, and monitor the platform from here.</p>
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
