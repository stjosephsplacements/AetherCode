import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/staff/page-header";
import { isRange } from "@/lib/platform-metrics";
import { loadSnapshot } from "@/lib/server/platform-snapshot";
import { requireStaff } from "@/lib/server/staff";
import { PlatformLive } from "./platform-live";

export const metadata: Metadata = { title: "Platform analytics" };

/** How the platform itself is doing: pods, CPU, memory and, once scraped, requests and latency. Platform administrators only. */
export default async function PlatformAnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const staff = await requireStaff();
  if (!staff.isPlatformAdmin) redirect("/staff");
  const requested = (await searchParams).range;
  const snapshot = await loadSnapshot(isRange(requested) ? requested : "1h");
  return (
    <>
      <PageHeader title="Platform" description="Live health and load of every service, from Prometheus. Updates every ten seconds while this page is open." />
      <PlatformLive initial={snapshot} />
    </>
  );
}
