import type { Metadata } from "next";
import Link from "next/link";
import { ChartBar } from "@phosphor-icons/react/ssr";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { Tile } from "@/components/staff/tile";
import { listDepartments, listBatches, listPlacement } from "@/lib/server/directory";
import { inColleges } from "@/lib/server/colleges";
import { requirePlacement } from "@/lib/server/placement";
import { listRoster } from "@/lib/server/students";
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
        const students = await listRoster(collegeId, batches.map((b) => b.id));
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
    const orgs = placementDir.organizations.map((org) => ({
      id: org.id,
      name: org.legal_name,
      code: org.code ?? "",
      status: org.status ?? "",
      tracks: (org.departments ?? []).map((d) => ({ id: d.id, label: d.name })),
    }));
    data = { rows, orgs, total: rows.length, assigned: rows.filter((r) => r.placementId).length };
  } catch (error) {
    return (
      <>
        <PageHeader title="Placement analytics" />
        <LoadError error={error} />
      </>
    );
  }

  const { rows, orgs, total, assigned } = data;
  const stats = orgStats(rows, orgs);

  return (
    <div className="animate-enter space-y-8">
      <PageHeader
        title="Placement analytics"
        description="Students placed across all tracks and organisations."
      />

      {/* Summary */}
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

      {/* Per org / track breakdown */}
      {stats.length === 0 ? (
        <p className="text-sm text-ink-muted">No placement organisations yet. <Link href="/placement/departments" className="text-brand hover:underline">Create one</Link>.</p>
      ) : (
        <div className="space-y-6">
          {stats.map(({ org, assigned: orgAssigned, perTrack }) => (
            <section key={org.id} className="rounded-[var(--radius-surface)] border border-line bg-surface p-5">
              <div className="mb-4 flex items-center gap-3">
                <ChartBar className="size-4 text-brand" />
                <h2 className="text-[15px] font-semibold text-ink">{org.name}</h2>
                <span className="ml-auto font-mono text-[13px] text-ink-muted">{orgAssigned} students</span>
              </div>
              {perTrack.length === 0 ? (
                <p className="text-[13px] text-ink-subtle">No tracks yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {perTrack.map(({ track, assigned: trackCount }) => (
                    <li key={track.id} className="flex items-center gap-3 py-2.5 text-[13.5px]">
                      <Link
                        href={`/placement?track=${track.id}`}
                        className="min-w-0 flex-1 truncate text-ink hover:text-brand hover:underline"
                      >
                        {track.label}
                      </Link>
                      <span className="font-mono tabular-nums text-ink">{trackCount}</span>
                      <span className="w-10 text-right text-[12px] text-ink-subtle">
                        {percent(trackCount, total)}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      <p className="text-[13px] text-ink-subtle">
        <Link href="/placement/exams" className="text-brand hover:underline">View placement exams</Link>{" "}
        for assessment data.
      </p>
    </div>
  );
}
