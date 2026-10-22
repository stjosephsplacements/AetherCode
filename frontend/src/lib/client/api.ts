"use client";

import type { Problem } from "@/lib/api-types";

export class APIError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Options = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Reuse one key when retrying the same logical write. */
  idempotencyKey?: string;
  signal?: AbortSignal;
};

/**
 * Calls the platform from the browser through /api. Safe Exam Browser signs
 * these requests itself, which is why exam calls must be made from here.
 */
export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["Idempotency-Key"] = options.idempotencyKey ?? crypto.randomUUID();

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`/api${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: options.signal,
    });
    if (response.status === 503 && attempt < 3) {
      const wait = Math.min(Number(response.headers.get("Retry-After")) || 1, 5);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      continue;
    }
    if (response.status === 401) {
      // A full page load, so no client state outlives the session.
      window.location.assign(new URL(`/login?next=${encodeURIComponent(location.pathname)}`, location.origin).href);
      throw new APIError(401, "unauthenticated", "Your session has ended.");
    }
    if (response.status === 204) return undefined as T;
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw toAPIError(response.status, payload);
    return payload as T;
  }
}

const SEB_REFUSAL = "secure exam browser validation failed";

/** Services answer {code, message}; the gateway's own refusals are {error}. */
function toAPIError(status: number, payload: unknown): APIError {
  const body = (payload ?? {}) as Partial<Problem> & { error?: string };
  if (status === 403 && body.error === SEB_REFUSAL) {
    return new APIError(403, "seb_required", "This exam must be taken in Safe Exam Browser.");
  }
  return new APIError(status, body.code ?? "error", body.message ?? body.error ?? `Request failed (HTTP ${status}).`);
}
