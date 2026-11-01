import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ServicesBadge, ServicesTable } from "@/components/staff/live-services";
import { JudgeMetrics } from "@/components/staff/judge-metrics";
import { PageHeader, Section } from "@/components/staff/page-header";
import type { GradingQueue } from "@/lib/api-types";
import { gateway } from "@/lib/server/gateway";
import { serviceHealth } from "@/lib/server/status";
import { requireStaff } from "@/lib/server/staff";
import { LiveRefresh } from "@/lib/client/realtime";

export const metadata: Metadata = { title: "System status" };

export default async function StatusPage() {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) redirect("/staff");
  const [health, queue] = await Promise.all([
    staff.tenantId ? serviceHealth(staff.tenantId).catch(() => null) : null,
    staff.tenantId ? gateway<GradingQueue>(`/submission/v1/tenants/${staff.tenantId}/grading-queue`).catch(() => null) : null,
  ]);
  return (
    <>
      <LiveRefresh topics={["grading"]} />
      <PageHeader
        title="System status"
        description="Live from the gateway, which checks every service it routes to every few seconds. The code-execution engine is checked by grading itself: a run that never finishes shows on the exam screen."
        actions={<ServicesBadge initial={health} />}
      />
      <ServicesTable initial={health} />
      {queue && (
        <Section title="Judge" description="Code waiting for the judge in this college, and how fast verdicts came back in the last hour.">
          <JudgeMetrics queue={queue} />
        </Section>
      )}
    </>
  );
}
