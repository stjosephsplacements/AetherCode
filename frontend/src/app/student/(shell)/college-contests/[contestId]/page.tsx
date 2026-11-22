import type { Metadata } from "next";
import { panel } from "@/app/admin/_dashboard/panel";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { gateway } from "@/lib/server/gateway";
import { requireStudent } from "@/lib/server/student";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Contest leaderboard" };

type Row = { actor_id: string; problems: number; last_solve: string };

export default async function ContestLeaderboardPage({ params }: { params: Promise<{ contestId: string }> }) {
  const { viewer, tenantId } = await requireStudent();
  const { contestId } = await params;
  let rows: Row[];
  try {
    rows = await gateway<Row[]>(`/question-bank/v1/tenants/${tenantId}/contests/${contestId}/leaderboard`);
  } catch (error) {
    return (
      <>
        <PageHeader title="Leaderboard" />
        <LoadError error={error} />
      </>
    );
  }
  const selfName = viewer.displayName.trim() || viewer.username.trim();
  return (
    <div className="animate-enter space-y-4">
      <PageHeader title="Live leaderboard" description="Accepted practice submits during the contest window." />
      <div className={cn(panel, "overflow-x-auto")}>
        <table className="w-full text-left text-xs">
          <thead className="text-ink-subtle">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Participant</th>
              <th className="px-3 py-2">Solved</th>
              <th className="px-3 py-2">Last solve</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const label =
                row.actor_id === viewer.principalId
                  ? selfName || "You"
                  : `Participant ${index + 1}`;
              return (
              <tr key={row.actor_id} className="border-t border-line/60">
                <td className="px-3 py-2 tabular-nums">{index + 1}</td>
                <td className="px-3 py-2 text-sm">{label}</td>
                <td className="px-3 py-2 tabular-nums font-semibold">{row.problems}</td>
                <td className="px-3 py-2 text-ink-muted">{formatDateTime(row.last_solve)}</td>
              </tr>
            );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-4 text-sm text-ink-muted">No accepted submissions yet.</p>}
      </div>
    </div>
  );
}