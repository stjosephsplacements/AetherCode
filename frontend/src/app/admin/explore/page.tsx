import {
  ArrowRight,
  BookOpen,
  Briefcase,
  Buildings,
  CalendarBlank,
  ChartBar,
  Chats,
  GraduationCap,
  House,
  NotePencil,
  Pulse,
  Question,
  Rocket,
  Scroll,
  ShieldCheck,
  UserGear,
  Users,
} from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import type { ComponentType, SVGProps } from "react";
import Link from "next/link";
import { panel } from "@/app/admin/_dashboard/panel";
import { CollegeLink } from "@/components/college-link";
import { EmptyState, PageHeader } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { lettermark } from "@/lib/lettermark";
import { collegeHref } from "@/lib/links";
import { requireAdmin } from "@/lib/server/staff";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Explore" };

type Glyph = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;
type ExploreLink = { href: string; label: string; Icon: Glyph; children?: ExploreLink[] };
type ExploreGroup = { label: string; links: ExploreLink[] };

/** Same ownership trees as the college sidebar. */
const STAFF_GROUPS: ExploreGroup[] = [
  {
    label: "Overview",
    links: [
      { href: "/staff", label: "Dashboard", Icon: House },
      { href: "/staff/get-started", label: "Get started", Icon: Rocket },
    ],
  },
  {
    label: "Set up",
    links: [
      {
        href: "/staff/departments",
        label: "Departments",
        Icon: Buildings,
        children: [{ href: "/staff/departments/batches", label: "Batches", Icon: GraduationCap }],
      },
      {
        href: "/staff/accounts",
        label: "Staff accounts",
        Icon: UserGear,
        children: [
          { href: "/staff/roles", label: "Roles", Icon: ShieldCheck },
          { href: "/staff/permissions", label: "Permissions", Icon: ShieldCheck },
        ],
      },
      { href: "/staff/students", label: "Students", Icon: Users },
    ],
  },
  {
    label: "Assess",
    links: [
      { href: "/staff/questions", label: "Questions", Icon: BookOpen },
      {
        href: "/staff/exams",
        label: "Exams",
        Icon: NotePencil,
        children: [
          { href: "/staff/proctor-policies", label: "Proctor policies", Icon: ShieldCheck },
          { href: "/staff/calendar", label: "Calendar", Icon: CalendarBlank },
        ],
      },
      { href: "/staff/analytics", label: "Analytics", Icon: ChartBar },
      { href: "/staff/community", label: "Community", Icon: Chats },
    ],
  },
  {
    label: "Platform",
    links: [
      { href: "/staff/audit", label: "Audit log", Icon: Scroll },
      { href: "/staff/status", label: "System status", Icon: Pulse },
      { href: "/staff/help", label: "FAQ and guides", Icon: Question },
    ],
  },
];

const PLACEMENT_SETUP_LINKS: ExploreLink[] = [
  { href: "/admin/placement", label: "Placement setup", Icon: Briefcase },
  { href: "/admin/placement/departments", label: "Organisation", Icon: Buildings },
  { href: "/admin/placement/officers", label: "Officers", Icon: UserGear },
];

/**
 * Platform administrators pick a college, then open the real /staff or /placement
 * consoles with that college as context — same pages and actions those areas expose.
 */
export default async function AdminExplorePage({ searchParams }: { searchParams: Promise<{ college?: string }> }) {
  const staff = await requireAdmin();
  const requested = (await searchParams).college;
  const selected = staff.tenants.find((tenant) => tenant.id === requested) ?? null;
  const active = staff.tenants.filter((tenant) => tenant.status === "active").length;

  return (
    <div className="animate-enter space-y-6">
      <PageHeader
        title="Explore"
        description={
          selected
            ? `Working in ${selected.display_name}. Open the college workspace or jump to a page.`
            : `${active} active of ${staff.tenants.length} college${staff.tenants.length === 1 ? "" : "s"}. Pick one for the staff workspace; placement is always global.`
        }
        actions={
          selected ? (
            <Button asChild>
              <CollegeLink href={collegeHref("/staff", selected.id)}>
                Open workspace
                <ArrowRight />
              </CollegeLink>
            </Button>
          ) : staff.tenants.length === 0 ? (
            <Button asChild>
              <Link href="/admin/colleges">
                Add college
                <ArrowRight />
              </Link>
            </Button>
          ) : undefined
        }
      />

      {staff.tenants.length === 0 ? (
        <section className={cn(panel)}>
          <EmptyState>
            <p className="mb-2 text-[15px] font-medium text-ink">No colleges yet</p>
            <Link href="/admin/colleges" className="text-brand hover:underline">
              Create a college
            </Link>{" "}
            first, then come back here to open its workspace.
          </EmptyState>
        </section>
      ) : selected ? (
        <>
          {/* Focal: selected college */}
          <section aria-label="Selected college" className={cn(panel)}>
            <div className="flex flex-wrap items-center gap-4">
              <span
                aria-hidden
                className="grid size-11 shrink-0 place-items-center rounded-control bg-brand-soft font-mono text-[13px] font-semibold text-brand-soft-ink"
              >
                {lettermark(selected.display_name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-ink-muted">Selected college</p>
                <p className="mt-0.5 truncate text-[17px] font-semibold tracking-[-0.02em] text-ink">{selected.display_name}</p>
                <p className="mt-0.5 font-mono text-[12px] text-ink-subtle">
                  {selected.slug} · {selected.status}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild>
                  <CollegeLink href={collegeHref("/staff", selected.id)}>
                    Open workspace
                    <ArrowRight />
                  </CollegeLink>
                </Button>
                <Link href="/admin/explore" className="px-2 text-[13px] font-medium text-ink-muted hover:text-ink">
                  Change
                </Link>
              </div>
            </div>
          </section>

          {/* Workspace destinations — tree groups, list-first */}
          <section aria-label="College workspace">
            <div className="mb-3">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">College workspace</h2>
              <p className="mt-0.5 text-[13px] text-ink-muted">Same pages as /staff for {selected.display_name}.</p>
            </div>
            <div className="space-y-4">
              {STAFF_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="mb-1.5 px-1 text-[12px] font-medium text-ink-muted">{group.label}</p>
                  <DestinationTree links={group.links} collegeId={selected.id} />
                </div>
              ))}
            </div>
          </section>
        </>
      ) : (
        /* College directory leads */
        <section aria-label="College directory">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Pick a college</h2>
              <p className="mt-0.5 text-[13px] text-ink-muted">Opens the staff workspace with that college as context.</p>
            </div>
            <p className="font-mono text-[12px] tabular-nums text-ink-subtle">
              {active} active · {staff.tenants.length} total
            </p>
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-surface border border-line bg-surface shadow-[var(--shadow-panel)]">
            {staff.tenants.map((tenant) => (
              <li key={tenant.id}>
                <Link
                  href={`/admin/explore?college=${encodeURIComponent(tenant.id)}`}
                  className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-hover"
                >
                  <span
                    aria-hidden
                    className="grid size-9 shrink-0 place-items-center rounded-control bg-brand-soft font-mono text-[12px] font-semibold text-brand-soft-ink"
                  >
                    {lettermark(tenant.display_name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">{tenant.display_name}</span>
                    <span className="mt-0.5 block truncate font-mono text-[11.5px] text-ink-subtle">{tenant.slug}</span>
                  </span>
                  <Badge tone={tenant.status === "active" ? "success" : "neutral"}>
                    {tenant.status === "active" ? "Active" : tenant.status}
                  </Badge>
                  <ArrowRight className="size-3.5 shrink-0 text-ink-subtle transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-hover:translate-x-0.5 group-hover:text-ink" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Placement setup — admin only; officers work in /placement (ADR-0089). */}
      <section aria-label="Placement setup">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Placement setup</h2>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              Organisation, tracks and officers. Day-to-day work stays in the placement staff console.
            </p>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href="/admin/placement">
              Open setup
              <ArrowRight />
            </Link>
          </Button>
        </div>
        <DestinationList links={PLACEMENT_SETUP_LINKS} />
      </section>
    </div>
  );
}

function DestinationList({ links, collegeId }: { links: ExploreLink[]; collegeId?: string }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-surface border border-line bg-surface shadow-[var(--shadow-panel)]">
      {links.map((item) => {
        const href = collegeHref(item.href, collegeId);
        const className =
          "group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-hover";
        return (
          <li key={item.href}>
            {collegeId ? (
              <CollegeLink href={href} className={className}>
                <item.Icon className="size-4 shrink-0 text-ink-muted group-hover:text-ink" />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{item.label}</span>
                <ArrowRight className="size-3.5 shrink-0 text-ink-subtle transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-hover:translate-x-0.5 group-hover:text-ink" />
              </CollegeLink>
            ) : (
              <Link href={href} className={className}>
                <item.Icon className="size-4 shrink-0 text-ink-muted group-hover:text-ink" />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{item.label}</span>
                <ArrowRight className="size-3.5 shrink-0 text-ink-subtle transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-hover:translate-x-0.5 group-hover:text-ink" />
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Nested destinations mirroring sidebar ownership trees. */
function DestinationTree({ links, collegeId }: { links: ExploreLink[]; collegeId: string }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-surface border border-line bg-surface shadow-[var(--shadow-panel)]">
      {links.map((item) => (
        <li key={item.href}>
          <CollegeLink
            href={collegeHref(item.href, collegeId)}
            className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-hover"
          >
            <item.Icon className="size-4 shrink-0 text-ink-muted group-hover:text-ink" />
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{item.label}</span>
            <ArrowRight className="size-3.5 shrink-0 text-ink-subtle transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-hover:translate-x-0.5 group-hover:text-ink" />
          </CollegeLink>
          {item.children && item.children.length > 0 && (
            <ul className="border-t border-line bg-hover/30">
              {item.children.map((child, index, all) => (
                <li key={child.href} className="relative pl-10">
                  <TreeGuides last={index === all.length - 1} />
                  <CollegeLink
                    href={collegeHref(child.href, collegeId)}
                    className="group flex items-center gap-3 py-2.5 pr-4 transition-colors hover:bg-hover"
                  >
                    <child.Icon className="size-3.5 shrink-0 text-ink-muted group-hover:text-ink" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{child.label}</span>
                    <ArrowRight className="size-3 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
                  </CollegeLink>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function TreeGuides({ last }: { last: boolean }) {
  if (last) {
    return (
      <span
        aria-hidden
        className="pointer-events-none absolute left-4 top-0 h-1/2 w-3 rounded-bl-[7px] border-b border-l border-line"
      />
    );
  }
  return (
    <span aria-hidden className="pointer-events-none absolute inset-y-0 left-4 w-3">
      <span className="absolute inset-y-0 left-0 w-px bg-line" />
      <span className="absolute left-0 top-1/2 h-px w-full -translate-y-px bg-line" />
    </span>
  );
}
