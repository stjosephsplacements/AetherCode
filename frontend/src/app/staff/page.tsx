import { Plus, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { JudgeMetrics } from "@/components/staff/judge-metrics";
import { Button } from "@/components/ui/button";
import type { AuditEntry, ExamMonitor, ExamResult, GradingQueue, Page, QuestionDetail } from "@/lib/api-types";
import { brandFor } from "@/lib/server/branding";
import { listExams, mapLimit } from "@/lib/server/exams";
import { gateway } from "@/lib/server/gateway";
import { describeAccounts } from "@/lib/server/people";
import { CollegeBar } from "@/components/staff/college-bar";
import { requireStaff } from "@/lib/server/staff";
import { serviceHealth } from "@/lib/server/status";
import { LiveRefresh } from "@/lib/client/realtime";
import { ServicesTile } from "./_dashboard/services-tile";
import { PASS_SHARE } from "@/lib/results";
import { TIME_ZONE, formatDateTime } from "@/lib/utils";
import { Clock } from "./_dashboard/live";
import { ActivityTile, DAY, DAYS, FigureTile, type Floor, LiveTile, type Outcome, ResultsTile, type Scheduled, TimelineTile, UpcomingTile, WeekDetail } from "./_dashboard/blocks";

export const metadata: Metadata = { title: "Dashboard" };

const ROLE_NAMES: Record<string, string> = {
  super_admin: "Platform administrator",
  college_admin: "College administrator",
  department_user: "Faculty",
  mentor: "Mentor",
  placement_user: "Placement staff",
  student: "Student",
};

/** Closed exams whose results the dashboard charts. */
const RECENT = 6;

async function settle<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

const zoned = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** The wall clock in the college's time zone, and midnight at the start of its day as epoch ms. */
function clock(at: Date): { hour: number; midnight: number } {
  const part: Record<string, number> = {};
  for (const { type, value } of zoned.formatToParts(at)) part[type] = Number(value);
  const { year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0 } = part;
  const offset = Math.round((Date.UTC(year, month - 1, day, hour, minute, second) - at.getTime()) / 60_000) * 60_000;
  return { hour, midnight: Date.UTC(year, month - 1, day) - offset };
}

export default async function Dashboard() {
  const staff = await requireStaff();
  const tenantId = staff.tenantId;
  const admin = staff.canManageAccounts;
  const now = new Date();
  const { hour, midnight: start } = clock(now);
  const end = start + DAYS * DAY;
  const firstName = staff.viewer.displayName.split(" ")[0] || staff.viewer.username;

  const [exams, questions, queue, health, audit, brand] = await Promise.all([
    tenantId ? settle(listExams(tenantId)) : Promise.resolve(null),
    settle(gateway<Page<QuestionDetail>>("/question-bank/v1/questions?limit=100")),
    tenantId && admin ? settle(gateway<GradingQueue>(`/submission/v1/tenants/${tenantId}/grading-queue`)) : Promise.resolve(null),
    tenantId && admin ? settle(serviceHealth(tenantId)) : Promise.resolve(null),
    tenantId && admin ? settle(gateway<AuditEntry[]>(`/user/v1/tenants/${tenantId}/staff-audit`)) : Promise.resolve(null),
    brandFor(tenantId),
  ]);

  const published = (exams ?? []).filter((entry): entry is Scheduled => entry.version?.status === "published");
  const opens = (entry: Scheduled) => Date.parse(entry.version.opens_at);
  const closes = (entry: Scheduled) => Date.parse(entry.version.closes_at);
  const live = published.filter((entry) => opens(entry) <= now.getTime() && closes(entry) > now.getTime());
  const week = published.filter((entry) => opens(entry) < end && closes(entry) > start).sort((a, b) => opens(a) - opens(b));
  const upcoming = published.filter((entry) => opens(entry) > now.getTime()).sort((a, b) => opens(a) - opens(b));
  const recent = published.filter((entry) => closes(entry) <= now.getTime()).sort((a, b) => closes(b) - closes(a)).slice(0, RECENT);
  const drafts = (exams ?? []).filter(({ version }) => version?.status === "draft").length;
  const activity = (audit ?? []).slice(0, 20);

  // Second wave: each live exam's monitor, each recent exam's results, and the names behind the activity.
  const [floors, outcomes, names] = tenantId
    ? await Promise.all([
        mapLimit(live, 4, async (entry): Promise<Floor | null> => {
          const monitor = await settle(gateway<ExamMonitor>(`/submission/v1/tenants/${tenantId}/exam-versions/${entry.version.id}/monitor`));
          if (!monitor) return null;
          const candidates = monitor.candidates;
          return {
            exam: entry,
            waiting: candidates.filter((candidate) => !candidate.attempt_id).length,
            writing: candidates.filter((candidate) => candidate.attempt_id && !candidate.submitted_at).length,
            submitted: candidates.filter((candidate) => candidate.submitted_at).length,
            flags: candidates.reduce((sum, candidate) => sum + candidate.flags, 0),
          };
        }),
        mapLimit(recent, 6, async (entry): Promise<Outcome | null> => {
          const rows = (await settle(gateway<ExamResult[]>(`/analytics/v1/tenants/${tenantId}/exam-results?exam_version_id=${entry.version.id}&limit=5000`))) ?? [];
          const shares = rows.filter((row) => Number(row.maximum_score) > 0).map((row) => Number(row.score) / Number(row.maximum_score));
          if (shares.length === 0) return null;
          return { exam: entry, attempts: shares.length, average: shares.reduce((sum, share) => sum + share, 0) / shares.length, pass: shares.filter((share) => share >= PASS_SHARE).length / shares.length };
        }),
        activity.length ? describeAccounts(tenantId, activity.map((entry) => entry.principal_id)).catch(() => new Map()) : Promise.resolve(new Map()),
      ])
    : [[], [], new Map()];

  const floor = floors.filter((entry): entry is Floor => entry !== null);
  const graded = outcomes.filter((entry): entry is Outcome => entry !== null);
  const attempts = graded.reduce((sum, entry) => sum + entry.attempts, 0);
  const average = attempts ? graded.reduce((sum, entry) => sum + entry.average * entry.attempts, 0) / attempts : null;
  const passed = attempts ? graded.reduce((sum, entry) => sum + entry.pass * entry.attempts, 0) / attempts : null;
  const waiting = queue ? queue.evaluations.queued + queue.evaluations.dispatched + queue.runs.queued + queue.runs.dispatched : null;

  return (
    <div className="animate-enter">
      <CollegeBar staff={staff} />
      <LiveRefresh topics={["attempts", "grading", "activity"]} />
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[12px] text-ink-subtle">
            <Clock initial={now.toISOString()} />
            {brand.name && <span className="text-ink-muted"> / {brand.name}</span>}
          </p>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.03em] text-ink">Dashboard</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}, {firstName}. {[...new Set(staff.viewer.roles)].map((role) => ROLE_NAMES[role] ?? role).join(", ")}.
          </p>
        </div>
        {tenantId && (
          <div className="flex shrink-0 gap-2">
            {admin && (
              <Button asChild variant="secondary">
                <Link href="/staff/students">
                  <Upload />
                  Import students
                </Link>
              </Button>
            )}
            <Button asChild>
              <Link href="/staff/exams/new">
                <Plus />
                New exam
              </Link>
            </Button>
          </div>
        )}
      </header>

      {!tenantId ? (
        <p className="mt-8 rounded-[var(--radius-surface)] border border-dashed border-line-strong px-5 py-4 text-sm text-ink-muted">
          No college exists yet. Provision one through the platform API, then choose it in the sidebar.
        </p>
      ) : (
        <div className="mt-7 grid auto-rows-[minmax(152px,auto)] gap-3 md:grid-cols-6 xl:grid-cols-12">
          <LiveTile floors={floor} next={upcoming[0]} now={now.getTime()} className="md:col-span-6 xl:col-span-4 xl:row-span-2" />
          <FigureTile
            label="This week"
            value={String(week.length)}
            note={upcoming[0] ? `next ${formatDateTime(upcoming[0].version.opens_at)}` : "Nothing scheduled"}
            expand={{ title: "This week", description: `Published exams over the next ${DAYS} days.`, content: <WeekDetail exams={week} now={now.getTime()} /> }}
            className="md:col-span-3 xl:col-span-2"
          />
          <FigureTile
            label="Average score"
            value={average === null ? "-" : `${Math.round(average * 100)}%`}
            note={passed === null ? "No graded exams yet" : `${Math.round(passed * 100)}% pass, last ${graded.length} exams`}
            className="md:col-span-3 xl:col-span-2"
          />
          {admin && queue ? (
            <FigureTile
              label="Judge"
              value={waiting ? String(waiting) : "Idle"}
              note={waiting ? "submissions waiting" : `${queue.evaluations.completed_last_hour} graded in the last hour`}
              tone={waiting ? "warn" : "good"}
              expand={{ title: "Judge queue", description: "Code waiting for the judge in this college, and how fast verdicts came back in the last hour.", content: <JudgeMetrics queue={queue} /> }}
              className="md:col-span-3 xl:col-span-2"
            />
          ) : (
            <FigureTile label="Drafts" value={String(drafts)} note="exams not yet published" className="md:col-span-3 xl:col-span-2" />
          )}
          {admin ? (
            <ServicesTile initial={health} queue={queue} className="md:col-span-3 xl:col-span-2" />
          ) : (
            <FigureTile label="Questions" value={questions ? `${questions.items.length}${questions.next_cursor ? "+" : ""}` : "-"} note="in the shared bank" className="md:col-span-3 xl:col-span-2" />
          )}
          <TimelineTile start={start} now={now.getTime()} exams={week} className="md:col-span-6 xl:col-span-8" />
          <ResultsTile outcomes={graded} now={now.getTime()} className={admin ? "md:col-span-6 xl:col-span-5" : "md:col-span-6 xl:col-span-7"} />
          <UpcomingTile exams={upcoming.slice(0, 20)} now={now.getTime()} className={admin ? "md:col-span-3 xl:col-span-3" : "md:col-span-6 xl:col-span-5"} />
          {admin && <ActivityTile entries={activity} names={names} now={now.getTime()} className="md:col-span-3 xl:col-span-4" />}
        </div>
      )}
    </div>
  );
}
