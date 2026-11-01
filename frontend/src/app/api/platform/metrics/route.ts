import { NextResponse } from "next/server";
import { isRange } from "@/lib/platform-metrics";
import { loadSnapshot } from "@/lib/server/platform-snapshot";
import { requireStaff } from "@/lib/server/staff";

/**
 * Live platform metrics for the Platform analytics page. Platform administrators only:
 * the figures describe every college, and the queries are fixed on the server.
 */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff.isPlatformAdmin) return NextResponse.json({ error: "Platform administrators only." }, { status: 403 });
  const requested = new URL(request.url).searchParams.get("range");
  const snapshot = await loadSnapshot(isRange(requested) ? requested : "1h");
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
