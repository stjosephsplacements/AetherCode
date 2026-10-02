import { sql } from "./db.ts";

export interface Health {
  ok: boolean;
  database: boolean;
  worker: { ok: boolean; lastSeenSeconds: number | null; engine: string | null; workers: number };
  engine: { ok: boolean; detail: string };
  queue: { queued: number; running: number; oldestQueuedSeconds: number | null; gradedLast5Min: number };
}

const WORKER_STALE_SECONDS = 30;

async function probeEngine(): Promise<{ ok: boolean; detail: string }> {
  const url = process.env.ENGINE_URL;
  if (!url) return { ok: false, detail: "ENGINE_URL is not set" };
  const path = (process.env.ENGINE ?? "judge0") === "piston" ? "/api/v2/runtimes" : "/about";
  try {
    const response = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(3000) });
    return { ok: response.ok, detail: response.ok ? "reachable" : `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "unreachable" };
  }
}

export async function checkHealth(): Promise<Health> {
  const engine = await probeEngine();
  try {
    const [worker] = await sql<{ last_seen: number | null; engine: string | null; workers: number }[]>`
      SELECT extract(epoch FROM now() - max(seen_at))::int AS last_seen,
        (array_agg(engine ORDER BY seen_at DESC))[1] AS engine,
        count(*) FILTER (WHERE seen_at > now() - make_interval(secs => ${WORKER_STALE_SECONDS}))::int AS workers
      FROM worker_heartbeats`;
    const [queue] = await sql<{ queued: number; running: number; oldest: number | null; graded: number }[]>`
      SELECT count(*) FILTER (WHERE status = 'queued')::int AS queued,
        count(*) FILTER (WHERE status = 'running')::int AS running,
        extract(epoch FROM now() - min(created_at) FILTER (WHERE status = 'queued'))::int AS oldest,
        (SELECT count(*)::int FROM submissions WHERE finished_at > now() - interval '5 minutes') AS graded
      FROM submissions WHERE status IN ('queued', 'running')`;
    const workerOk = worker.workers > 0;
    return {
      ok: workerOk && engine.ok,
      database: true,
      worker: { ok: workerOk, lastSeenSeconds: worker.last_seen, engine: worker.engine, workers: worker.workers },
      engine,
      queue: { queued: queue.queued, running: queue.running, oldestQueuedSeconds: queue.oldest, gradedLast5Min: queue.graded },
    };
  } catch {
    return {
      ok: false,
      database: false,
      worker: { ok: false, lastSeenSeconds: null, engine: null, workers: 0 },
      engine,
      queue: { queued: 0, running: 0, oldestQueuedSeconds: null, gradedLast5Min: 0 },
    };
  }
}
