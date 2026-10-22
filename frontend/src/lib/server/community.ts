import "server-only";
import { gateway } from "./gateway";

type Query = Record<string, string | number | boolean | undefined>;

function withQuery(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

/** The college's community content (ADR-0048). */
export function communityPath(tenantId: string, path: string, query?: Query): string {
  return withQuery(`/notification/v1/tenants/${tenantId}/community/${path}`, query);
}

/** A list endpoint: `{ items: [...] }`. */
export async function communityList<T>(tenantId: string, path: string, query?: Query): Promise<T[]> {
  return (await gateway<{ items: T[] }>(communityPath(tenantId, path, query))).items;
}

export async function communityRequest<T>(tenantId: string, path: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  return gateway<T>(communityPath(tenantId, path), { method, body });
}
