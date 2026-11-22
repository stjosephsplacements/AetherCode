import type { Metadata } from "next";
import type { Icon } from "@phosphor-icons/react";
import {
  ArrowRight,
  Briefcase,
  Buildings,
  ChartBar,
  ChartDonut,
  CheckCircle,
  ClipboardText,
  Pulse,
  Scroll,
  UserGear,
  Warning,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { panel } from "@/app/admin/_dashboard/panel";
import { PageHeader } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import { listPlacement } from "@/lib/server/directory";
import { listSuperAdmins } from "@/lib/server/people";
import { requireAdmin } from "@/lib/server/staff";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Get started" };

type Step = {
  key: string;
  title: string;
  text: string;
  href: string;
  cta: string;
  done: boolean;
  optional?: boolean;
  Icon: Icon;
};

type Destination = { href: string; title: string; text: string; Icon: Icon };

export default async function AdminGetStarted() {
  const staff = await requireAdmin();
  const firstName = staff.viewer.displayName.split(" ")[0] || staff.viewer.username;
  const [admins, placement] = await Promise.all([
    listSuperAdmins(staff.tenants, staff.viewer).catch(() => []),
    listPlacement().catch(() => ({ organizations: [], readable: false as const })),
  ]);
  const hasCollege = staff.tenants.length > 0;
  const hasExtraAdmin = admins.filter((admin) => !admin.root).length > 0;
  const trackCount = placement.readable
    ? placement.organizations.reduce((sum, organization) => sum + organization.departments.length, 0)
    : 0;
  const hasPlacement = !placement.readable || trackCount > 0;
  const firstCollege = staff.tenants[0];

  const launch: Step[] = [
    {
      key: "college",
      title: "Create a college",
      text: "A college holds departments, batches, staff and students. Everything else hangs off it.",
      href: "/admin/colleges",
      cta: hasCollege ? "Manage colleges" : "Add college",
      done: hasCollege,
      Icon: Buildings,
    },
    {
      key: "workspace",
      title: "Open a college workspace",
      text: "Departments, students, questions and exams live inside a college console.",
      href: hasCollege && firstCollege ? `/admin/explore?college=${firstCollege.id}` : "/admin/colleges",
      cta: hasCollege ? "Explore college" : "Create a college first",
      done: hasCollege,
      Icon: ClipboardText,
    },
    {
      key: "admins",
      title: "Add administrators",
      text: "Give platform-wide access to trusted staff, then narrow their permissions.",
      href: "/admin/admins",
      cta: hasExtraAdmin ? "Review admins" : "Add administrator",
      done: hasExtraAdmin,
      optional: true,
      Icon: UserGear,
    },
    {
      key: "placement",
      title: "Set up placement",
      text: "Create the one placement organisation, then add global tracks students enrol under.",
      href: "/admin/placement/departments",
      cta: hasPlacement ? "Review placement" : "Placement departments",
      done: hasPlacement,
      optional: true,
      Icon: Briefcase,
    },
  ];

  const afterLaunch: Destination[] = [
    { href: "/admin/dashboard", title: "Dashboard", text: "Dense charts for queues, health and cohort", Icon: ChartDonut },
    { href: "/admin/incidents", title: "Incidents", text: "Open problems and live exam controls", Icon: Warning },
    { href: "/admin/status", title: "System status", text: "Service health and judge queue", Icon: Pulse },
    { href: "/admin/analytics", title: "Analytics", text: "Prometheus load and latency", Icon: ChartBar },
    { href: "/admin/audit", title: "Audit log", text: "Staff changes across colleges", Icon: Scroll },
  ];

  const required = launch.filter((step) => !step.optional);
  const doneRequired = required.filter((step) => step.done).length;
  const doneLaunch = launch.filter((step) => step.done).length;
  const next = launch.find((step) => !step.done) ?? null;
  const complete = doneRequired === required.length;
  const exploreHref = firstCollege ? `/admin/explore?college=${firstCollege.id}` : "/admin/colleges";
  const primaryHref = complete ? exploreHref : (next?.href ?? "/admin/colleges");
  const primaryCta = complete ? "Explore college" : (next?.cta ?? "Continue");

  return (
    <div className="animate-enter space-y-6">
      <PageHeader
        title={complete ? `Ready, ${firstName}` : `Get started, ${firstName}`}
        description={
          complete
            ? `${staff.tenants.length} college${staff.tenants.length === 1 ? "" : "s"} · ${admins.length} admin${admins.length === 1 ? "" : "s"}${placement.readable ? ` · ${trackCount} placement track${trackCount === 1 ? "" : "s"}` : ""}. Launch is done — operate from the console.`
            : `${doneRequired} of ${required.length} required · ${doneLaunch}/${launch.length} on the checklist. Work top to bottom; optional steps can wait.`
        }
        actions={
          <Button asChild>
            <Link href={primaryHref}>
              {primaryCta}
              <ArrowRight />
            </Link>
          </Button>
        }
      />

      {/* Focal: one next job, or ready state */}
      <section aria-label={complete ? "Launch complete" : "Next step"} className={cn(panel)}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-ink-muted">{complete ? "Launch complete" : "Do this next"}</p>
            <p className="mt-1 flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-ink">
              {complete ? (
                <CheckCircle className="size-5 shrink-0 text-success" weight="fill" />
              ) : next ? (
                <next.Icon className="size-5 shrink-0 text-brand" />
              ) : null}
              {complete ? "Platform is ready to run" : next?.title}
            </p>
            <p className="mt-2 max-w-[54ch] text-[13.5px] leading-relaxed text-ink-muted">
              {complete
                ? "Open a college workspace to add departments, students and exams, or use the operating links below."
                : next?.text}
            </p>
          </div>
          <Button asChild variant={complete ? "secondary" : "primary"} className="shrink-0">
            <Link href={primaryHref}>
              {primaryCta}
              <ArrowRight />
            </Link>
          </Button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <div className="h-1.5 min-w-[8rem] flex-1 overflow-hidden rounded-pill bg-hover" role="img" aria-label={`${doneRequired} of ${required.length} required steps done`}>
            <span
              className={cn("block h-full rounded-pill", complete ? "bg-success" : "bg-brand")}
              style={{ width: `${required.length ? Math.round((doneRequired / required.length) * 100) : 100}%` }}
            />
          </div>
          <p className="font-mono text-[12px] tabular-nums text-ink-muted">
            {doneRequired}/{required.length} required
            {launch.some((step) => step.optional) ? ` · ${launch.filter((step) => step.optional && step.done).length}/${launch.filter((step) => step.optional).length} optional` : ""}
          </p>
        </div>
      </section>

      {/* Checklist leads */}
      <section aria-label="Launch checklist">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Launch checklist</h2>
            <p className="mt-0.5 text-[13px] text-ink-muted">Required first, then optional polish.</p>
          </div>
          <p className="font-mono text-[12px] tabular-nums text-ink-subtle">
            {doneLaunch}/{launch.length}
          </p>
        </div>
        <ol className="divide-y divide-line overflow-hidden rounded-surface border border-line bg-surface shadow-[var(--shadow-panel)]">
          {launch.map((step, index) => {
            const Icon = step.Icon;
            const isNext = next?.key === step.key;
            return (
              <li key={step.key}>
                <Link
                  href={step.href}
                  className={cn(
                    "group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-hover sm:gap-4",
                    isNext && "bg-brand-soft/25",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid size-8 shrink-0 place-items-center rounded-control",
                      step.done ? "bg-success/15 text-success" : isNext ? "bg-brand/15 text-brand" : "bg-hover text-ink-muted",
                    )}
                    aria-hidden
                  >
                    {step.done ? <CheckCircle className="size-4" weight="fill" /> : <Icon className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] tabular-nums text-ink-subtle">{String(index + 1).padStart(2, "0")}</span>
                      <span className="text-[14px] font-semibold text-ink">{step.title}</span>
                      {step.done && <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-success">Done</span>}
                      {isNext && !step.done && <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-brand">Next</span>}
                      {step.optional && !step.done && !isNext && (
                        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-subtle">Optional</span>
                      )}
                    </span>
                    <span className="mt-1 block text-[12.5px] leading-snug text-ink-muted">{step.text}</span>
                  </span>
                  <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-brand">
                    {step.cta}
                    <ArrowRight className="size-3.5 opacity-70 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      {/* After launch — flat destinations, same weight as Overview list */}
      <section aria-label="After launch">
        <div className="mb-3">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">After launch</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">Day-to-day ops once a college is standing.</p>
        </div>
        <ul className="divide-y divide-line overflow-hidden rounded-surface border border-line bg-surface shadow-[var(--shadow-panel)]">
          {afterLaunch.map(({ href, title, text, Icon }) => (
            <li key={href}>
              <Link href={href} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-hover">
                <Icon className="size-4 shrink-0 text-ink-muted group-hover:text-ink" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">{title}</span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-ink-muted">{text}</span>
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-ink-subtle transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-hover:translate-x-0.5 group-hover:text-ink" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
