import "server-only";

type Envelope<T> = { status: "success"; data: { result: T } } | { status: "error"; error: string };

/** Where Prometheus is reachable from the server, or null when the platform has none configured. */
export function prometheusURL(): string | null {
  const value = process.env.PROMETHEUS_URL?.trim().replace(/\/+$/, "");
  return value ? value : null;
}

async function call<T>(path: string, params: Record<string, string>): Promise<T> {
  const base = prometheusURL();
  if (!base) throw new Error("PROMETHEUS_URL is not set");
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Prometheus answered ${response.status}`);
  const body = (await response.json()) as Envelope<T>;
  if (body.status !== "success") throw new Error(body.error);
  return body.data.result;
}

export const instant = <T>(expression: string) => call<T>("/api/v1/query", { query: expression });

export const range = <T>(expression: string, start: number, end: number, step: number) =>
  call<T>("/api/v1/query_range", { query: expression, start: String(start), end: String(end), step: String(step) });
