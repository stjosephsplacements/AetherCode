import { panel } from "@/app/admin/_dashboard/panel";
import { EmptyState, Section } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import { gateway } from "@/lib/server/gateway";
import { cn, formatDateTime } from "@/lib/utils";
import { syncCollegePlatformProfiles } from "./profiles-actions";

export type PlatformProfileRow = {
  student_id: string;
  principal_id: string;
  enrollment_number: string;
  profile_name?: string;
  platform: string;
  handle: string;
  stats: string[] | unknown;
  fetched_at?: string;
  status: string;
  failure?: string;
};

type Page = {
  items: PlatformProfileRow[];
  summary: Record<string, number>;
};

export async function ProfilesView({ collegeId }: { collegeId: string }) {
  let page: Page;
  try {
    page = await gateway<Page>(`/user/v1/tenants/${collegeId}/platform-profiles?limit=200`);
  } catch {
    page = { items: [], summary: {} };
  }
  return (
    <Section
      title="Coding profiles"
      description="Cached stats from linked handles. Live fetches still run on individual student pages when cache is empty."
      actions={
        <form action={syncCollegePlatformProfiles.bind(null, collegeId)}>
          <Button type="submit" size="sm">
            Sync everyone
          </Button>
        </form>
      }
    >
      {page.items.length === 0 ? (
        <EmptyState>No cached platform profiles yet. Students link handles on their profile, then run Sync.</EmptyState>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-ink-muted">
            {page.summary.fresh ?? 0} fresh · {page.summary.stale ?? 0} stale · {page.summary.pending ?? 0} pending · {page.summary.failed ?? 0} failed
          </p>
          <div className="overflow-x-auto">
            <table className={cn(panel, "w-full text-left text-xs")}>
              <thead className="text-ink-subtle">
                <tr>
                  <th className="px-3 py-2 font-medium">Student</th>
                  <th className="px-3 py-2 font-medium">Platform</th>
                  <th className="px-3 py-2 font-medium">Handle</th>
                  <th className="px-3 py-2 font-medium">Stats</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Fetched</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((row) => (
                  <tr key={`${row.student_id}-${row.platform}`} className="border-t border-line/60">
                    <td className="px-3 py-2">
                      <div className="font-medium text-ink">{row.profile_name || row.enrollment_number}</div>
                      <div className="font-mono text-[10px] text-ink-muted">{row.enrollment_number}</div>
                    </td>
                    <td className="px-3 py-2 capitalize">{row.platform}</td>
                    <td className="px-3 py-2 font-mono">{row.handle}</td>
                    <td className="px-3 py-2 text-ink-muted">
                      {Array.isArray(row.stats) ? row.stats.join(" · ") : "—"}
                    </td>
                    <td className="px-3 py-2 capitalize">{row.status}</td>
                    <td className="px-3 py-2 text-ink-muted">{row.fetched_at ? formatDateTime(row.fetched_at) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Section>
  );
}