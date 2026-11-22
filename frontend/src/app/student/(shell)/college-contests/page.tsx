import type { Metadata } from "next";
import Link from "next/link";
import { panel } from "@/app/admin/_dashboard/panel";
import { EmptyState, PageHeader } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import { gateway } from "@/lib/server/gateway";
import { requireStudent } from "@/lib/server/student";
import { cn, formatDateTime } from "@/lib/utils";
import { registerContest } from "./actions";

export const metadata: Metadata = { title: "College contests" };

type Contest = {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  lifecycle: string;
  registered: boolean;
  question_ids: string[];
};

export default async function CollegeContestsPage() {
  const student = await requireStudent();
  const contests = await gateway<Contest[]>(`/question-bank/v1/tenants/${student.tenantId}/contests`).catch(() => [] as Contest[]);
  return (
    <div className="animate-enter space-y-6">
      <PageHeader title="College contests" description="Timed practice contests run by your placement team." />
      {contests.length === 0 ? (
        <EmptyState>No college contests are scheduled yet.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {contests.map((contest) => (
            <li key={contest.id} className={cn(panel, "flex flex-wrap items-center justify-between gap-3 p-4")}>
              <div>
                <h2 className="font-semibold text-ink">{contest.title}</h2>
                <p className="text-xs text-ink-muted">
                  {formatDateTime(contest.starts_at)} → {formatDateTime(contest.ends_at)} · {contest.lifecycle} · {contest.question_ids.length} problems
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`/student/college-contests/${contest.id}`}>Leaderboard</Link>
                </Button>
                {!contest.registered && contest.lifecycle !== "ended" ? (
                  <form action={registerContest.bind(null, student.tenantId, contest.id)}>
                    <Button type="submit" size="sm">
                      Register
                    </Button>
                  </form>
                ) : (
                  <span className="text-xs text-ink-muted self-center">{contest.registered ? "Registered" : "Ended"}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}