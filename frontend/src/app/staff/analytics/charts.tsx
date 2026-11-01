"use client";

import { Tooltip } from "radix-ui";
import { type Bucket, type ExamPoint, percent } from "@/lib/analytics";
import { PASS_SHARE } from "@/lib/results";
import { cn, formatDateTime } from "@/lib/utils";

const TIP = "z-50 animate-fade rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[12.5px] text-ink shadow-[var(--shadow-overlay)]";

/** The dashed line at the pass mark, drawn across a chart plot whose height is 0 to 100%. */
function PassLine() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ink-muted/70" style={{ bottom: `${PASS_SHARE * 100}%` }}>
      <span className="absolute -top-4 right-0 bg-surface pl-1 font-mono text-[10.5px] text-ink-subtle">pass {percent(PASS_SHARE)}</span>
    </div>
  );
}

function Axis() {
  return (
    <div aria-hidden className="flex h-full flex-col justify-between pr-2 text-right font-mono text-[10.5px] tabular-nums text-ink-subtle">
      <span>100%</span>
      <span>50%</span>
      <span>0</span>
    </div>
  );
}

const MAX_BARS = 24;

/**
 * The average of every exam in time order, one bar each. A bar under the pass mark is
 * outlined in the danger colour and says so in its tooltip, so colour is never the only cue.
 */
export function ExamTrend({ points }: { points: ExamPoint[] }) {
  const ordered = [...points].sort((a, b) => a.at.localeCompare(b.at));
  const shown = ordered.slice(-MAX_BARS);
  return (
    <Tooltip.Provider delayDuration={80} skipDelayDuration={0}>
      <figure className="mt-4">
        <div className="grid grid-cols-[auto_1fr] gap-x-1" role="img" aria-label={`Average score of the last ${shown.length} exams: ${shown.map((point) => `${point.title} ${percent(point.average)}`).join(", ")}`}>
          <div className="h-44">
            <Axis />
          </div>
          <div className="relative h-44 border-b border-line">
            <PassLine />
            <div className="absolute inset-0 flex items-end gap-[3px]">
              {shown.map((point) => {
                const below = point.average < PASS_SHARE;
                return (
                  <Tooltip.Root key={point.id}>
                    <Tooltip.Trigger asChild>
                      <button type="button" aria-label={`${point.title}, average ${percent(point.average)}`} className="group relative flex h-full min-w-1 flex-1 items-end outline-none">
                        <span
                          className={cn(
                            "block w-full rounded-t-[3px] transition-[filter,opacity] group-hover:brightness-110 group-focus-visible:ring-2 group-focus-visible:ring-brand",
                            below ? "bg-danger/70" : "bg-ink/55 group-hover:bg-ink/75",
                          )}
                          style={{ height: `${Math.max(point.average * 100, 1.5)}%` }}
                        />
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content side="top" sideOffset={6} className={TIP}>
                        <p className="max-w-56 truncate font-medium">{point.title}</p>
                        {point.college && <p className="text-ink-muted">{point.college.name}</p>}
                        <p className="mt-0.5 font-mono tabular-nums">
                          {percent(point.average)} average{below ? ", below the pass mark" : ""}
                        </p>
                        <p className="font-mono tabular-nums text-ink-muted">
                          {point.graded} graded, {percent(point.pass)} passed
                        </p>
                        <p className="text-ink-subtle">{formatDateTime(point.at)}</p>
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                );
              })}
            </div>
          </div>
        </div>
        <figcaption className="mt-2 flex justify-between pl-9 font-mono text-[11px] text-ink-subtle">
          <span>{shown[0] ? formatDateTime(shown[0].at).split(",")[0] : ""}</span>
          <span>{ordered.length > shown.length ? `latest ${shown.length} of ${ordered.length}` : `${shown.length} exam${shown.length === 1 ? "" : "s"}`}</span>
          <span>{shown.at(-1) ? formatDateTime(shown.at(-1)!.at).split(",")[0] : ""}</span>
        </figcaption>
      </figure>
    </Tooltip.Provider>
  );
}

/** How many attempts landed in each tenth of the marks. Bands under the pass mark use the danger colour. */
export function ScoreHistogram({ buckets }: { buckets: Bucket[] }) {
  const tallest = Math.max(...buckets.map((bucket) => bucket.count), 1);
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  return (
    <Tooltip.Provider delayDuration={80} skipDelayDuration={0}>
      <figure className="mt-4">
        <div className="relative h-36 border-b border-line" role="img" aria-label={`Score distribution of ${total} attempts: ${buckets.map((bucket) => `${percent(bucket.from)} to ${percent(bucket.to)}: ${bucket.count}`).join(", ")}`}>
          <div className="absolute inset-0 flex items-end gap-[3px]">
            {buckets.map((bucket) => {
              const below = bucket.to <= PASS_SHARE + 1e-9;
              return (
                <Tooltip.Root key={bucket.from}>
                  <Tooltip.Trigger asChild>
                    <button type="button" aria-label={`${percent(bucket.from)} to ${percent(bucket.to)}, ${bucket.count} attempts`} className="group flex h-full flex-1 items-end outline-none">
                      <span
                        className={cn("block w-full rounded-t-[3px] transition-[filter] group-hover:brightness-110 group-focus-visible:ring-2 group-focus-visible:ring-brand", below ? "bg-danger/70" : "bg-ink/55")}
                        style={{ height: `${bucket.count ? Math.max((bucket.count / tallest) * 100, 3) : 0}%` }}
                      />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content side="top" sideOffset={6} className={TIP}>
                      <p className="font-mono tabular-nums">
                        {percent(bucket.from)} to {percent(bucket.to)}
                      </p>
                      <p className="font-mono tabular-nums text-ink-muted">
                        {bucket.count} attempt{bucket.count === 1 ? "" : "s"}, {total ? percent(bucket.count / total) : "0%"}
                        {below ? ", below the pass mark" : ""}
                      </p>
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              );
            })}
          </div>
        </div>
        <div aria-hidden className="mt-2 flex justify-between font-mono text-[11px] tabular-nums text-ink-subtle">
          <span>0</span>
          <span>25%</span>
          <span>50%</span>
          <span>75%</span>
          <span>100%</span>
        </div>
      </figure>
    </Tooltip.Provider>
  );
}
