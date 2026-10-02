import { checkHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

// Unauthenticated, so it only reports up/down, never queue details.
export async function GET() {
  const health = await checkHealth();
  return Response.json(
    { ok: health.ok, database: health.database, worker: health.worker.ok, engine: health.engine.ok },
    { status: health.ok ? 200 : 503 },
  );
}
