"use client";

import { Badge } from "@/components/ui/card";
import { useRealtime } from "@/lib/client/realtime";
import type { HealthMessage } from "@/lib/client/realtime-protocol";
import { cn, formatTime } from "@/lib/utils";

const panel =
  "flex min-w-0 flex-col rounded-surface border border-line bg-surface p-5 shadow-[var(--shadow-panel)]";

function asHealth(value: HealthMessage | null | undefined): HealthMessage | null {
  return value && Array.isArray(value.services) ? value : null;
}

function useServices(initial: HealthMessage | null): HealthMessage | null {
  const { health } = useRealtime();
  return asHealth(health) ?? asHealth(initial);
}

/** Live gateway health: headline strip, readiness bar, per-service list. */
export default function ServicesBoard({ initial, className }: { initial: HealthMessage | null; className?: string }) {
  const snapshot = useServices(initial);
  if (!snapshot) {
    return (
      <section className={cn(panel, className)}>
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Services</h2>
        <p className="mt-2 text-sm text-ink-muted">The gateway did not return its service list. It needs the realtime endpoint (ADR-0050).</p>
      </section>
    );
  }

  const ready = snapshot.services.filter((service) => service.ready).length;
  const down = snapshot.services.length - ready;
  const slowest = snapshot.services.reduce((worst, service) => Math.max(worst, service.milliseconds), 0);
  const share = snapshot.services.length ? Math.round((ready / snapshot.services.length) * 100) : 0;

  return (
    <section aria-label="Services" className={cn(panel, className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{down === 0 ? "All services ready" : "Service attention"}</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">Gateway probes for this college context.</p>
        </div>
        <p className="font-mono text-[12px] tabular-nums text-ink-subtle">checked {formatTime(snapshot.checked_at)}</p>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 sm:grid-cols-4">
        <div>
          <dt className="text-[12px] text-ink-muted">Ready</dt>
          <dd className="mt-0.5 flex items-center gap-1.5 font-mono text-[18px] font-semibold tabular-nums tracking-[-0.02em] text-ink">
            <span aria-hidden className={cn("size-1.5 rounded-pill", down ? "bg-danger" : "bg-success")} />
            {ready}/{snapshot.services.length || 0}
          </dd>
          <p className="mt-0.5 text-[11.5px] text-ink-subtle">{down ? `${down} not ready` : "every probe passed"}</p>
        </div>
        <div>
          <dt className="text-[12px] text-ink-muted">Ready share</dt>
          <dd className="mt-0.5 font-mono text-[18px] font-semibold tabular-nums tracking-[-0.02em] text-ink">{share}%</dd>
          <p className="mt-0.5 text-[11.5px] text-ink-subtle">last probe</p>
        </div>
        <div>
          <dt className="text-[12px] text-ink-muted">Slowest</dt>
          <dd className="mt-0.5 font-mono text-[18px] font-semibold tabular-nums tracking-[-0.02em] text-ink">{slowest} ms</dd>
          <p className="mt-0.5 text-[11.5px] text-ink-subtle">worst in this round</p>
        </div>
        <div>
          <dt className="text-[12px] text-ink-muted">Services</dt>
          <dd className="mt-0.5 font-mono text-[18px] font-semibold tabular-nums tracking-[-0.02em] text-ink">{snapshot.services.length}</dd>
          <p className="mt-0.5 text-[11.5px] text-ink-subtle">routed by the gateway</p>
        </div>
      </dl>

      <div className="mt-4 flex h-2 overflow-hidden rounded-pill bg-hover" role="img" aria-label={`${ready} of ${snapshot.services.length} services ready`}>
        {snapshot.services.length > 0 && (
          <>
            <span className="bg-success" style={{ width: `${(ready / snapshot.services.length) * 100}%` }} />
            <span className="bg-danger" style={{ width: `${(down / snapshot.services.length) * 100}%` }} />
          </>
        )}
      </div>

      <ul className="mt-4 divide-y divide-line overflow-hidden rounded-control border border-line">
        {snapshot.services.map((service) => (
          <li key={service.name} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span aria-hidden className={cn("size-2 shrink-0 rounded-pill", service.ready ? "bg-success" : "bg-danger")} />
              <span className="min-w-0">
                <span className="block truncate font-mono text-[13px] font-medium text-ink">{service.name}</span>
                {service.description && <span className="mt-0.5 block truncate text-[12px] text-ink-muted">{service.description}</span>}
              </span>
            </span>
            <div className="flex items-center gap-3">
              <span className="relative hidden h-1 w-24 overflow-hidden rounded-pill bg-line sm:block">
                <span
                  className={cn("absolute inset-y-0 left-0 rounded-pill", service.ready ? "bg-brand" : "bg-danger")}
                  style={{ width: `${Math.min(100, Math.max(4, (service.milliseconds / Math.max(slowest, 1)) * 100))}%` }}
                />
              </span>
              <span className="font-mono text-[12px] tabular-nums text-ink-muted">{service.milliseconds} ms</span>
              <Badge tone={service.ready ? "success" : "danger"}>{service.ready ? "Ready" : "Down"}</Badge>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
