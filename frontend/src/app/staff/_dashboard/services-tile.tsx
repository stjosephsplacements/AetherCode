"use client";

import { JudgeMetrics } from "@/components/staff/judge-metrics";
import { ServicesTable, useServices } from "@/components/staff/live-services";
import type { GradingQueue } from "@/lib/api-types";
import type { HealthMessage } from "@/lib/client/realtime-protocol";
import { FigureTile } from "./blocks";

/** Ready services out of all the gateway routes to, updating with every probe. */
export function ServicesTile({ initial, queue, className }: { initial: HealthMessage | null; queue: GradingQueue | null; className?: string }) {
  const snapshot = useServices(initial);
  if (!snapshot) return <FigureTile label="Services" value="-" note="gateway list unavailable" className={className} />;
  const ready = snapshot.services.filter((service) => service.ready).length;
  const total = snapshot.services.length;
  return (
    <FigureTile
      label="Services"
      value={`${ready}/${total}`}
      note={ready === total ? "all ready" : `${total - ready} not ready`}
      tone={ready === total ? "good" : "bad"}
      expand={{ title: "Services", description: "Live from the gateway, which checks every service it routes to.",
        content: (
          <div className="space-y-8">
            <ServicesTable initial={snapshot} />
            {queue && (
              <section aria-label="Judge">
                <h3 className="mb-3 text-[15px] font-semibold tracking-[-0.01em] text-ink">Judge</h3>
                <JudgeMetrics queue={queue} />
              </section>
            )}
          </div>
        ), }}
      className={className}
    />
  );
}
