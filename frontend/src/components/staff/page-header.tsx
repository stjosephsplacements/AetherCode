import { WarningCircle } from "@phosphor-icons/react/ssr";
import type { GatewayError } from "@/lib/server/gateway";

/** A ruled header: the hairline under it is where the page's work begins. */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink [text-wrap:balance]">{title}</h1>
        {description && <p className="mt-1.5 max-w-[68ch] text-sm leading-relaxed text-ink-muted [text-wrap:pretty]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, description, children, actions }: { title: string; description?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="mt-12">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {description && <p className="mt-0.5 max-w-[72ch] text-[13px] text-ink-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-surface)] border border-dashed border-line-strong px-6 py-12 text-center text-sm text-ink-muted">
      <p aria-hidden className="mb-2 font-mono text-[12px] text-ink-subtle">
        [ empty ]
      </p>
      {children}
    </div>
  );
}

/** Shown when a request fails, typically because the role may not read this. */
export function LoadError({ error }: { error: unknown }) {
  const status = (error as GatewayError | undefined)?.status;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-[var(--radius-surface)] border border-line bg-surface px-5 py-4 text-sm text-ink-muted">
      <WarningCircle className="mt-0.5 size-4 shrink-0 text-danger" />
      <p>
        {status === 403
          ? "Your role cannot see this. Ask a college administrator."
          : `This could not be loaded${error instanceof Error ? `: ${error.message}` : "."}`}
      </p>
    </div>
  );
}

/** A ruled ledger for staff lists: mono column heads, rows that light up on hover. */
export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-surface)] border border-line bg-surface">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line bg-sidebar">
            {head.map((label) => (
              <th key={label} scope="col" className="px-4 py-2.5 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-ink-subtle">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_tr]:transition-colors [&_tr:hover]:bg-hover [&_tr+tr]:border-t [&_tr+tr]:border-line">{children}</tbody>
      </table>
    </div>
  );
}
