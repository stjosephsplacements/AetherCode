"use client";

import { Badge } from "@/components/ui/card";
import { useRealtime } from "@/lib/client/realtime";
import type { HealthMessage } from "@/lib/client/realtime-protocol";
import ServicesBoard from "./services-board";

/** Accept only a real health payload; emulator stubs and empty pages are treated as unknown. */
function asHealth(value: HealthMessage | null | undefined): HealthMessage | null {
  return value && Array.isArray(value.services) ? value : null;
}

/** The gateway's latest health snapshot: pushed over the socket, else the one the page rendered with. */
export function useServices(initial: HealthMessage | null): HealthMessage | null {
  const { health } = useRealtime();
  return asHealth(health) ?? asHealth(initial);
}

export function ServicesBadge({ initial }: { initial: HealthMessage | null }) {
  const snapshot = useServices(initial);
  if (!snapshot) return <Badge tone="warning">Unknown</Badge>;
  const down = snapshot.services.filter((service) => !service.ready).length;
  return <Badge tone={down ? "danger" : "success"}>{down ? `${down} not ready` : "All services ready"}</Badge>;
}

/** Compact board for dashboard expand panels. */
export function ServicesTable({ initial }: { initial: HealthMessage | null }) {
  return <ServicesBoard initial={initial} />;
}
