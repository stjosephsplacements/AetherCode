import "server-only";
import type { ExamMonitor, GradingQueue } from "@/lib/api-types";
import type { HealthMessage } from "@/lib/client/realtime-protocol";
import type { Snapshot } from "@/lib/platform-metrics";
import { inColleges } from "./colleges";
import { type CollegeExam, listAllExams, mapLimit } from "./exams";
import { gateway } from "./gateway";
import { loadSnapshot } from "./platform-snapshot";
import type { StaffContext } from "./staff";
import { serviceHealth } from "./status";

export type Incident = { severity: "critical" | "warning"; title: string; detail: string; href?: string };

export type LiveExam = {
  collegeId: string;
  collegeName: string;
  examId: string;
  versionId: string;
  title: string;
  closesAt: string;
  assigned: number;
  inProgress: number;
  handedIn: number;
  notStarted: number;
  flags: number;
};

export type CollegeQueue = { collegeId: string; collegeName: string; queue: GradingQueue | null };

export type IncidentBoard = {
  checkedAt: string;
  incidents: Incident[];
  health: HealthMessage | null;
  snapshot: Snapshot;
  queues: CollegeQueue[];
  liveExams: LiveExam[];
};

const WAIT_WARN_SECONDS = 120;
const WAIT_CRITICAL_SECONDS = 600;
const MAX_LIVE_EXAMS = 24;

/** Everything the incident board shows, across every college, with the problems it implies. */
export async function loadIncidents(staff: StaffContext): Promise<IncidentBoard> {
  const colleges = staff.tenants.map((tenant) => ({ id: tenant.id, name: tenant.display_name }));
  const now = Date.now();
  const [health, snapshot, queues, exams] = await Promise.all([
    staff.tenantId ? serviceHealth(staff.tenantId).catch(() => null) : null,
    loadSnapshot("1h"),
    inColleges(colleges, (id) => gateway<GradingQueue>(`/submission/v1/tenants/${id}/grading-queue`)),
    listAllExams(staff.tenants),
  ]);

  const open = exams
    .filter((entry): entry is CollegeExam & { version: NonNullable<CollegeExam["version"]> } => {
      const version = entry.version;
      return version !== null && version.status === "published" && Date.parse(version.opens_at) <= now && now < Date.parse(version.closes_at);
    })
    .slice(0, MAX_LIVE_EXAMS);
  const liveExams = (
    await mapLimit(open, 4, async (entry): Promise<LiveExam | null> => {
      try {
        const monitor = await gateway<ExamMonitor>(`/submission/v1/tenants/${entry.college.id}/exam-versions/${entry.version.id}/monitor`);
        const started = monitor.candidates.filter((candidate) => candidate.attempt_id);
        return {
          collegeId: entry.college.id,
          collegeName: entry.college.name,
          examId: entry.exam.id,
          versionId: entry.version.id,
          title: entry.version.title,
          closesAt: entry.version.closes_at,
          assigned: monitor.candidates.length,
          inProgress: started.filter((candidate) => !candidate.submitted_at).length,
          handedIn: started.filter((candidate) => candidate.submitted_at).length,
          notStarted: monitor.candidates.length - started.length,
          flags: monitor.candidates.reduce((sum, candidate) => sum + candidate.flags, 0),
        };
      } catch {
        return null;
      }
    })
  ).filter((exam): exam is LiveExam => exam !== null);

  const incidents: Incident[] = [];
  if (!health) incidents.push({ severity: "critical", title: "Service health unavailable", detail: "The gateway did not answer the health check.", href: "/admin/status" });
  for (const service of health?.services ?? []) {
    if (!service.ready) incidents.push({ severity: "critical", title: `${service.name} is not ready`, detail: service.description ?? "The gateway cannot reach it.", href: "/admin/status" });
  }
  if (snapshot.prometheus === "ok") {
    for (const row of snapshot.services) {
      if (row.desired !== null && row.available !== null && row.available < row.desired) {
        incidents.push({ severity: "critical", title: `${row.name}: ${row.available} of ${row.desired} replicas available`, detail: "A pod is not ready. A version mismatch between services is a common cause.", href: "/admin/analytics" });
      } else if ((row.restarts ?? 0) >= 3) {
        incidents.push({ severity: "warning", title: `${row.name} restarted ${Math.round(row.restarts ?? 0)} times in the last hour`, detail: "It may be crash-looping or running out of memory.", href: "/admin/analytics" });
      }
    }
  }
  for (const { college, value, failed } of queues) {
    if (failed || !value) {
      incidents.push({ severity: "warning", title: `${college.name}: grading queue unavailable`, detail: "The submission service did not answer for this college." });
      continue;
    }
    for (const [kind, stats] of [["Grading", value.evaluations], ["Runs", value.runs]] as const) {
      const waited = stats.oldest_waiting_at ? (now - Date.parse(stats.oldest_waiting_at)) / 1000 : 0;
      if (waited >= WAIT_WARN_SECONDS) {
        incidents.push({
          severity: waited >= WAIT_CRITICAL_SECONDS ? "critical" : "warning",
          title: `${college.name}: ${kind.toLowerCase()} waiting ${Math.round(waited / 60)} min`,
          detail: `${stats.queued} queued, ${stats.dispatched} with the judge.`,
          href: "/admin/status",
        });
      }
      const done = stats.completed_last_hour + stats.failed_last_hour;
      if (stats.failed_last_hour >= 3 && stats.failed_last_hour / done > 0.2) {
        incidents.push({ severity: "warning", title: `${college.name}: ${kind.toLowerCase()} failing`, detail: `${stats.failed_last_hour} of ${done} in the last hour failed.`, href: "/admin/status" });
      }
    }
  }
  incidents.sort((a, b) => Number(b.severity === "critical") - Number(a.severity === "critical"));

  return {
    checkedAt: new Date(now).toISOString(),
    incidents,
    health,
    snapshot,
    queues: queues.map(({ college, value }) => ({ collegeId: college.id, collegeName: college.name, queue: value })),
    liveExams,
  };
}
