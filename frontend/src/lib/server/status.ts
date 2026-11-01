import "server-only";
import type { HealthMessage } from "@/lib/client/realtime-protocol";
import { gateway } from "@/lib/server/gateway";

/**
 * Every service the gateway routes to, with its readiness and response time.
 * The list and descriptions are the gateway's configuration (ADR-0050), not this app's.
 */
export function serviceHealth(tenantId: string): Promise<HealthMessage> {
  return gateway<HealthMessage>(`/realtime/services?tenant=${encodeURIComponent(tenantId)}`);
}
