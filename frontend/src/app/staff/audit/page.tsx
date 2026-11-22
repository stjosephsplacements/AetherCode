import { ShieldCheck, ShieldWarning, Users } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, LoadError, PageHeader } from "@/components/staff/page-header";
import { asAuditEntries } from "@/lib/audit-entries";
import { auditAction } from "@/lib/audit";
import { LiveRefresh } from "@/lib/client/realtime";
import { inColleges } from "@/lib/server/colleges";
import { gateway } from "@/lib/server/gateway";
import { describeAccounts } from "@/lib/server/people";
import { collegesFor, requireStaff } from "@/lib/server/staff";
import { TIME_ZONE, formatDateTime } from "@/lib/utils";
import { AuditLog, type AuditRow } from "./audit-log";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) redirect("/staff");
  const { before } = await searchParams;

  let data;
  try {
    const perCollege = await inColleges(collegesFor(staff), async (collegeId) => {
      const body = await gateway<unknown>(`/user/v1/tenants/${collegeId}/staff-audit${before ? `?before=${encodeURIComponent(before)}` : ""}`);
      const found = asAuditEntries(body);
      const people = found.length ? await describeAccounts(collegeId, found.map((entry) => entry.principal_id)).catch(() => new Map()) : new Map();
      return { found, people };
    });
    const entries = perCollege
      .flatMap(({ college, value }) =>
        (value?.found ?? []).map((entry) => ({
          ...entry,
          collegeName: college.name,
          person: value?.people.get(entry.principal_id),
        })),
      )
      .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
      .slice(0, 100);
    data = { entries, unreachable: perCollege.filter((entry) => entry.failed).map((entry) => entry.college.name) };
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Audit log" />
        <LoadError error={error} />
      </div>
    );
  }

  const { entries, unreachable } = data;
  const several = false;
  const last = entries.at(-1);
  const dayOf = new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const timeOf = new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true });
  const rows: AuditRow[] = entries.map((entry, index) => {
    const resourceId = entry.resource_id?.trim() || "";
    return {
      key: `${entry.occurred_at}-${index}`,
      at: formatDateTime(entry.occurred_at),
      day: dayOf.format(new Date(entry.occurred_at)),
      time: timeOf.format(new Date(entry.occurred_at)),
      college: entry.collegeName,
      who: entry.person?.display_name ?? (entry.principal_id === staff.viewer.principalId ? staff.viewer.displayName : "Unknown account"),
      username: entry.person?.username ?? (entry.principal_id === staff.viewer.principalId ? staff.viewer.username : ""),
      what: auditAction(entry),
      on: resourceId ? resourceId.slice(0, 8) : "",
      resource: resourceId,
      allowed: entry.allowed !== false,
    };
  });

  const allowed = entries.filter((entry) => entry.allowed !== false).length;
  const refused = entries.length - allowed;
  const people = new Set(entries.map((entry) => entry.principal_id)).size;

  return (
    <div className="animate-enter space-y-6">
      {!before && <LiveRefresh topics={["activity"]} />}
      <PageHeader
        title="Audit log"
        description={`${entries.length} loaded · ${allowed} allowed · ${refused} refused · ${people} people. Newest first; kept for 400 days.`}
      />
      {unreachable.length > 0 && (
        <p role="alert" className="text-sm text-warning">
          Could not load: {unreachable.join(", ")}.
        </p>
      )}

      <section aria-label="Activity">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Activity</h2>
            <p className="mt-0.5 text-[13px] text-ink-muted">Every change staff made in this college, including refused attempts.</p>
          </div>
          <span className="inline-flex items-center gap-3 font-mono text-[11.5px] text-ink-subtle">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-success" /> {allowed}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldWarning className="size-3.5 text-warning" /> {refused}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-3.5 text-brand" /> {people}
            </span>
          </span>
        </div>

        {entries.length === 0 ? (
          <div className="rounded-surface border border-dashed border-line-strong bg-surface px-6 py-14 text-center shadow-[var(--shadow-panel)]">
            <EmptyState>{before ? "No older entries." : "No staff changes recorded yet."}</EmptyState>
          </div>
        ) : (
          <>
            <AuditLog rows={rows} several={several} />
            {last && entries.length >= 100 && (
              <Link href={`?before=${encodeURIComponent(last.occurred_at)}`} className="mt-4 inline-block text-sm text-brand hover:underline">
                Older entries
              </Link>
            )}
          </>
        )}
      </section>
    </div>
  );
}
