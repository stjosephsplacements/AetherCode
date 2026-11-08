import { ArrowRight, Buildings, ChartBar, Gear, Shield, Users, Warning } from "@phosphor-icons/react/ssr";
import type { Icon } from "@phosphor-icons/react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/server/staff";

export const metadata: Metadata = { title: "Get started" };

const STEPS: { icon: Icon; title: string; text: string; href: string; cta: string }[] = [
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
    <div className="mx-auto max-w-2xl animate-enter">
      {/* Hero */}
      <div className="mb-10 overflow-hidden rounded-3xl p-8" style={{ background: "var(--poster-sky)" }}>
        <p className="font-[family-name:var(--font-eyebrow)] text-[10px] uppercase tracking-[0.18em] text-white/50">
          Admin console
        </p>
        <h1 className="mt-2 text-[32px] font-bold leading-tight tracking-[-0.03em] text-white">
          Hey {firstName}
        </h1>
        <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-white/70">
          Set up colleges, manage administrators, and monitor the platform from here.
        </p>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical connecting line */}
        <div className="absolute left-[27px] top-6 bottom-6 w-px bg-line" aria-hidden />

        <ol className="space-y-2">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            const num = String(i + 1).padStart(2, "0");
            return (
              <li
                key={step.href}
                className="animate-enter"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <Link
                  href={step.href}
                  className="group relative flex items-center gap-5 rounded-2xl px-4 py-4 transition-colors hover:bg-hover"
                >
                  {/* Icon circle with liquid-glass */}
                  <div className="liquid-glass relative z-10 grid size-[54px] shrink-0 place-items-center rounded-2xl">
                    <Icon className="size-5 text-ink" />
                    <span
                      className="pointer-events-none absolute -bottom-0.5 -right-1 font-[family-name:var(--font-eyebrow)] text-[10px] font-bold leading-none text-ink-subtle opacity-60"
                      aria-hidden
                    >
                      {num}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold text-ink">{step.title}</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">{step.text}</p>
                  </div>

                  <span className="shrink-0 text-[13px] font-medium text-brand opacity-0 transition-opacity group-hover:opacity-100">
                    {step.cta}
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-ink-subtle transition-all group-hover:translate-x-0.5 group-hover:text-brand" />
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
