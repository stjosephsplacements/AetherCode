/** The students page while its data loads: the same bands as the page, so nothing jumps when rows arrive. */
export function RosterSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading students">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-[74px] animate-pulse rounded-[var(--radius-surface)] border border-line bg-surface" />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {[176, 176, 176, 256].map((width, index) => (
          <div key={index} className="h-8 animate-pulse rounded-full bg-hover" style={{ width }} />
        ))}
      </div>
      <div className="overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
        <div className="h-10 bg-sidebar" />
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 border-t border-line px-4 py-3.5">
            <div className="size-4 animate-pulse rounded bg-hover" />
            <div className="size-9 animate-pulse rounded-full bg-hover" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-3.5 w-40 animate-pulse rounded bg-hover" />
              <div className="h-3 w-24 animate-pulse rounded bg-hover" />
            </div>
            <div className="hidden h-5 w-16 animate-pulse rounded-full bg-hover sm:block" />
            <div className="hidden h-3.5 w-28 animate-pulse rounded bg-hover md:block" />
            <div className="hidden h-5 w-20 animate-pulse rounded-full bg-hover md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
