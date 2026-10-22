import "server-only";
import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import type { Problem } from "@/lib/api-types";
import { gatewayURL } from "./config";
import { clientIP } from "./request";
import { ACCESS_COOKIE } from "./tokens";

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Options = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Send without the session's bearer (login). */
  anonymous?: boolean;
  /** Use this bearer instead of the session cookie (right after login). */
  token?: string;
  /** Extra request headers, such as X-Tenant-ID for role assignments. */
  headers?: Record<string, string>;
};

/**
 * Calls the gateway from server components and server actions. Not for
 * Submission routes: Safe Exam Browser signs each browser request, so those
 * go from the browser through /api (see app/api/[...path]/route.ts).
 */
export async function gateway<T>(path: string, options: Options = {}): Promise<T> {
  const method = options.method ?? "GET";
  const requestHeaders: Record<string, string> = { ...options.headers, Accept: "application/json" };
  if (options.body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (method !== "GET") requestHeaders["Idempotency-Key"] = randomUUID();
  const ip = clientIP(await headers());
  if (ip) requestHeaders["X-Forwarded-For"] = ip;
  if (!options.anonymous) {
    const token = options.token ?? (await cookies()).get(ACCESS_COOKIE)?.value;
    if (!token) throw new GatewayError(401, "unauthenticated", "Your session has ended. Sign in again.");
    requestHeaders.Authorization = `Bearer ${token}`;
  }

  // The platform answers 503 with Retry-After while permissions or
  // projections settle (for a few seconds after a change); retry like smoke.py.
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${gatewayURL()}/api${path}`, {
      method,
      headers: requestHeaders,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
    });
    if (response.status === 503 && attempt < 3) {
      const wait = Math.min(Number(response.headers.get("Retry-After")) || 1, 5);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      continue;
    }
    if (response.status === 204) return undefined as T;
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      // Services answer {code, message}; the gateway's own refusals are {error}.
      const problem = (payload ?? {}) as Partial<Problem> & { error?: string };
      throw new GatewayError(response.status, problem.code ?? "error", problem.message ?? problem.error ?? `HTTP ${response.status}`);
    }
    return payload as T;
  }
}
