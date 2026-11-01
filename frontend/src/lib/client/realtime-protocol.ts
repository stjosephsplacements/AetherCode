/** What the gateway's staff WebSocket sends (ADR-0050). Hints carry no data; pages refetch. */

export type ServiceHealth = { name: string; description?: string; ready: boolean; milliseconds: number };
export type HealthMessage = { type: "health"; checked_at: string; services: ServiceHealth[] };
export type Topic = "attempts" | "grading" | "activity";
export type ChangedMessage = { type: "changed"; topic: Topic; id?: string; at: string };
export type RealtimeMessage = HealthMessage | ChangedMessage;

/** The gateway closes with this when the session expires; reconnect once the cookie is refreshed. */
export const SESSION_EXPIRED = 4401;

const TOPICS = new Set<string>(["attempts", "grading", "activity"]);

/** Parses one frame, ignoring anything this version of the console does not understand. */
export function parseMessage(data: unknown): RealtimeMessage | null {
  if (typeof data !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (message.type === "changed" && typeof message.topic === "string" && TOPICS.has(message.topic)) return message as ChangedMessage;
  if (message.type === "health" && Array.isArray(message.services) && typeof message.checked_at === "string") return message as HealthMessage;
  return null;
}

/** The socket URL: an explicit one from the build, else the page's own origin. */
export function realtimeURL(location: { protocol: string; host: string }, tenantId: string, configured?: string): string {
  const base = configured || `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/realtime`;
  const url = new URL(base);
  url.searchParams.set("tenant", tenantId);
  return url.toString();
}

/** Exponential backoff with jitter, 1 s doubling to a 30 s ceiling. */
export function backoff(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}
