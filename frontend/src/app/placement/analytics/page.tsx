import type { Metadata } from "next";
import Link from "next/link";
import { ChartBar } from "@phosphor-icons/react/ssr";
import { panel } from "@/app/admin/_dashboard/panel";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { Tile } from "@/components/staff/tile";
import { listDepartments, listBatches, listPlacement } from "@/lib/server/directory";
import { inColleges } from "@/lib/server/colleges";
import { requirePlacement } from "@/lib/server/placement";
import { primaryPlacementOrganization } from "@/lib/server/placement-org";
import { listRoster } from "@/lib/server/students";
import { cn } from "@/lib/utils";
import { orgStats, percent } from "../stats";

export const metadata: Metadata = { title: "Placement analytics" };

export default async function PlacementAnalyticsPage() {
  const placement = await requirePlacement();
  let data;
  try {
    const [placementDir, perCollege] = await Promise.all([
      listPlacement(),
      inColleges(placement.colleges, async (collegeId) => {
        const [departments, batches] = await Promise.all([listDepartments(collegeId), listBatches(collegeId)]);
        const students = await listRoster(collegeId, batches.map((batch) => batch.id));
        return { departments, batches, students };
      }),
    ]);
    const rows = perCollege.flatMap(({ value }) =>
      (value?.students ?? []).map((student) => ({
        id: student.id,
        roll: student.enrollment_number,
        name: "",
        status: student.status,
        college: "",
        batchId: student.batch_id ?? "",
        batch: "",
        departmentId: student.college_department_id ?? "",
        department: "",
        placementId: student.placement_department_id ?? "",
      })),
    );
    const organization = primaryPlacementOrganization(placementDir);
    const orgs = organization
      ? [
          {
            id: organization.id,
            name: organization.legal_name,
            code: organization.code ?? "",
            status: organization.status ?? "",
            tracks: (organization.departments ?? []).map((department) => ({ id: department.id, label: department.name })),
          },
        ]
      : [];
    data = { rows, orgs, total: rows.length, assigned: rows.filter((row) => row.placementId).length };
  } catch (error) {
    return (
      <>
        <PageHeader title="Placement analytics" />
        <LoadError error={error} />
      </>
    );
  }

  const { rows, orgs, total, assigned } = data;
  const [stat] = orgStats(rows, orgs);
  const tracks = stat?.perTrack ?? [];

  return (
    <div className="animate-enter space-y-6">
      <PageHeader
        title="Placement analytics"
        description="How students sit across the global placement tracks shared by every college."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Total students">
          <p className="font-mono text-[2rem] font-semibold text-ink">{total}</p>
        </Tile>
        <Tile label="Placed">
          <p className="font-mono text-[2rem] font-semibold text-success">{assigned}</p>
        </Tile>
        <Tile label="Not yet placed">
          <p className="font-mono text-[2rem] font-semibold text-ink-muted">{total - assigned}</p>
          <p className="mt-1 text-[13px] text-ink-subtle">{percent(assigned, total)}% placed</p>
        </Tile>
      </div>

      {!stat ? (
        <p className="text-sm text-ink-muted">
          No placement organisation yet. A platform administrator creates it under Placement setup.
        </p>
      ) : (
        <section className={cn(panel)}>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <ChartBar className="size-4 text-brand" />
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-ink">{stat.org.name}</h2>
              <p className="font-mono text-[11.5px] text-ink-subtle">{stat.org.code} · every college</p>
            </div>
            <span className="ml-auto font-mono text-[13px] tabular-nums text-ink-muted">{stat.assigned} placed</span>
          </div>
          {tracks.length === 0 ? (
            <p className="text-[13px] text-ink-subtle">
              No tracks yet. Ask a platform administrator to add placement departments.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {tracks.map(({ track, assigned: trackCount }) => (
                <li key={track.id} className="flex items-center gap-3 py-2.5 text-[13.5px]">
                  <Link href={`/placement?track=${track.id}`} className="min-w-0 flex-1 truncate text-ink hover:text-brand hover:underline">
                    {track.label}
                  </Link>
                  <span className="font-mono tabular-nums text-ink">{trackCount}</span>
                  <span className="w-10 text-right text-[12px] text-ink-subtle">{percent(trackCount, total)}%</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="text-[13px] text-ink-subtle">
        <Link href="/placement/exams" className="text-brand hover:underline">
          View placement exams
        </Link>{" "}
        for assessment data.
      </p>
    </div>
  );
}
