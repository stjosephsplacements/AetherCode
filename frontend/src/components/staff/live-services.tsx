"use client";

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
  const ready = snapshot.services.filter((service) => service.ready).length;
  const slowest = snapshot.services.reduce((worst, service) => Math.max(worst, service.milliseconds), 0);
  return (
    <>
      <ul className="mb-5 flex flex-wrap gap-2" aria-label="Summary">
        {[
          ["Services", snapshot.services.length],
          ["Ready", ready],
          ["Not ready", snapshot.services.length - ready],
          ["Slowest", `${slowest} ms`],
        ].map(([label, value]) => (
          <li key={label} className="inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1 px-3 text-[13px] text-ink-muted">
            {label}
            <span className="font-mono tabular-nums text-ink">{value}</span>
          </li>
        ))}
      </ul>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {snapshot.services.map((service) => (
          <li key={service.name} className="rounded-[var(--radius-surface)] border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 font-mono text-[13px] font-medium text-ink">
                <span aria-hidden className={`size-2 rounded-full ${service.ready ? "bg-success" : "bg-danger"}`} />
                {service.name}
              </span>
              <Badge tone={service.ready ? "success" : "danger"}>{service.ready ? "Ready" : "Not ready"}</Badge>
            </div>
            <p className="mt-1.5 text-[13px] text-ink-muted">{service.description ?? "-"}</p>
            <div className="mt-3 flex items-center gap-3">
              <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-line">
                <span className={`absolute inset-y-0 left-0 rounded-full ${service.ready ? "bg-brand" : "bg-danger"}`} style={{ width: `${Math.min(100, Math.max(4, (service.milliseconds / Math.max(slowest, 1)) * 100))}%` }} />
              </span>
              <span className="font-mono text-xs tabular-nums text-ink-muted">{service.milliseconds} ms</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 font-mono text-[11.5px] text-ink-subtle">checked {formatTime(snapshot.checked_at)}</p>
    </>
  );
}
