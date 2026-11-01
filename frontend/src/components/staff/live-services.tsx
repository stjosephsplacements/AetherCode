"use client";

import { Table } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import { useRealtime } from "@/lib/client/realtime";
import type { HealthMessage } from "@/lib/client/realtime-protocol";
import { formatTime } from "@/lib/utils";

/** The gateway's latest health snapshot: pushed over the socket, else the one the page rendered with. */
export function useServices(initial: HealthMessage | null): HealthMessage | null {
  const { health } = useRealtime();
  return health ?? initial;
}

export function ServicesBadge({ initial }: { initial: HealthMessage | null }) {
  const snapshot = useServices(initial);
  if (!snapshot) return <Badge tone="warning">Unknown</Badge>;
  const down = snapshot.services.filter((service) => !service.ready).length;
  return <Badge tone={down ? "danger" : "success"}>{down ? `${down} not ready` : "All services ready"}</Badge>;
}

/** Every service the gateway routes to, updating as the gateway probes them. */
export function ServicesTable({ initial }: { initial: HealthMessage | null }) {
  const snapshot = useServices(initial);
  if (!snapshot) {
    return <p className="text-sm text-ink-muted">The gateway did not return its service list. It needs the realtime endpoint (ADR-0050).</p>;
  }
  return (
    <>
      <Table head={["Service", "What it does", "Status", "Response"]}>
        {snapshot.services.map((service) => (
          <tr key={service.name}>
            <td className="px-4 py-2.5 font-mono text-[13px] text-ink">{service.name}</td>
            <td className="px-4 py-2.5 text-ink-muted">{service.description ?? "-"}</td>
            <td className="px-4 py-2.5">
              <Badge tone={service.ready ? "success" : "danger"}>{service.ready ? "Ready" : "Not ready"}</Badge>
            </td>
            <td className="px-4 py-2.5 font-mono tabular-nums text-ink-muted">{service.milliseconds} ms</td>
          </tr>
        ))}
      </Table>
      <p className="mt-2 font-mono text-[11.5px] text-ink-subtle">checked {formatTime(snapshot.checked_at)}</p>
    </>
  );
}
