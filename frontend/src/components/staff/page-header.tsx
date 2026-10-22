import type { GatewayError } from "@/lib/server/gateway";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="display text-[2rem] text-ink sm:text-[2.25rem]">{title}</h1>
        {description && <p className="mt-1.5 max-w-[60ch] text-[15px] text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, description, children, actions }: { title: string; description?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[var(--radius-surface)] border border-dashed border-line-strong px-6 py-10 text-center text-sm text-ink-muted">{children}</div>;
}

/** Shown when a request fails, typically because the role may not read this. */
export function LoadError({ error }: { error: unknown }) {
  const status = (error as GatewayError | undefined)?.status;
  return (
    <div className="rounded-[var(--radius-surface)] border border-line bg-surface px-5 py-4 text-sm text-ink-muted">
      {status === 403
        ? "Your role cannot see this. Ask a college administrator."
        : `This could not be loaded${error instanceof Error ? `: ${error.message}` : "."}`}
    </div>
  );
}

/** A plain bordered table for staff lists. */
export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-surface)] border border-line bg-surface">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-ink-muted">
            {head.map((label) => (
              <th key={label} scope="col" className="px-4 py-2.5 font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_tr+tr]:border-t [&_tr+tr]:border-line">{children}</tbody>
      </table>
    </div>
  );
}
