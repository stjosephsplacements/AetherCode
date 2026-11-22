import { ArrowRight, Buildings, UserGear } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { panel } from "@/app/admin/_dashboard/panel";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { lettermark } from "@/lib/lettermark";
import { listPlacement } from "@/lib/server/directory";
import { primaryPlacementOrganization } from "@/lib/server/placement-org";
import { requireAdmin } from "@/lib/server/staff";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Placement setup" };

/** Platform-admin home for placement: org + tracks + officers (ADR-0089). */
export default async function AdminPlacementPage() {
  await requireAdmin();
  let data;
  try {
    data = await listPlacement();
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Placement" />
        <LoadError error={error} />
      </div>
    );
  }

  const organization = primaryPlacementOrganization(data);
  const departments = organization?.departments ?? [];

  return (
    <div className="animate-enter space-y-6">
      <PageHeader
        title="Placement"
        description={
          organization
            ? `${organization.legal_name} · ${departments.length} track${departments.length === 1 ? "" : "s"}. Create tracks and assign officers here; officers work in /placement.`
            : "Create the single placement organisation, then add tracks and officers. Day-to-day work stays in /placement."
        }
        actions={
          <Button asChild>
            <Link href="/admin/placement/departments">
              {organization ? "Manage tracks" : "Create organisation"}
              <ArrowRight />
            </Link>
          </Button>
        }
      />

      {!data.readable ? (
        <section className={cn(panel)}>
          <p className="text-sm text-ink-muted">Could not load placement organisations.</p>
        </section>
      ) : (
        <>
          <section aria-label="Organisation" className={cn(panel)}>
            {!organization ? (
              <div>
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">No organisation yet</h2>
                <p className="mt-1 max-w-[54ch] text-[13.5px] text-ink-muted">
                  There is one placement organisation for the whole platform (ADR-0080). Create it, then add departments such as ELITE or HOPE.
                </p>
                <Button asChild className="mt-4">
                  <Link href="/admin/placement/departments">
                    Create organisation
                    <ArrowRight />
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-4">
                <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-control bg-brand-soft font-mono text-[13px] font-semibold text-brand-soft-ink">
                  {lettermark(organization.legal_name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-ink-muted">Organisation</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[17px] font-semibold tracking-[-0.02em] text-ink">
                    <span className="truncate">{organization.legal_name}</span>
                    <Badge tone={organization.status === "active" ? "success" : "neutral"}>{organization.status}</Badge>
                  </p>
                  <p className="mt-0.5 font-mono text-[12px] text-ink-subtle">
                    {organization.code} · {departments.length} department{departments.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
            )}
          </section>

          <section aria-label="Setup destinations">
            <div className="mb-3">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Setup</h2>
              <p className="mt-0.5 text-[13px] text-ink-muted">Org and tracks first, then officers for each track.</p>
            </div>
            <ul className="divide-y divide-line overflow-hidden rounded-surface border border-line bg-surface shadow-[var(--shadow-panel)]">
              <li>
                <Link href="/admin/placement/departments" className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-hover">
                  <Buildings className="size-4 shrink-0 text-ink-muted group-hover:text-ink" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-ink">Organisation and departments</span>
                    <span className="mt-0.5 block text-[12.5px] text-ink-muted">
                      {organization ? `${departments.length} track${departments.length === 1 ? "" : "s"}` : "Create the organisation"}
                    </span>
                  </span>
                  <ArrowRight className="size-3.5 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
                </Link>
              </li>
              <li>
                <Link href="/admin/placement/officers" className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-hover">
                  <UserGear className="size-4 shrink-0 text-ink-muted group-hover:text-ink" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-ink">Officers</span>
                    <span className="mt-0.5 block text-[12.5px] text-ink-muted">Assign staff to a placement department</span>
                  </span>
                  <ArrowRight className="size-3.5 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
                </Link>
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
