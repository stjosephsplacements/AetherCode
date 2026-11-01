"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { Paged } from "@/lib/paginate";

type Meta = Pick<Paged<unknown>, "page" | "pages" | "total" | "from" | "to">;

/** Prev/next footer for a server-paged list. Keeps every other query param (college, filters). */
export function Pager({ meta, param = "page", noun = "rows" }: { meta: Meta; param?: string; noun?: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  if (meta.pages <= 1) return null;

  const href = (page: number) => {
    const next = new URLSearchParams(search.toString());
    if (page <= 1) next.delete(param);
    else next.set(param, String(page));
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const btn = "rounded-md border border-line px-3 py-1.5 text-xs transition-colors";

  return (
    <nav aria-label="Pagination" className="mt-3 flex items-center justify-between gap-3 text-xs text-ink-subtle">
      <span className="tabular-nums">
        {meta.from}-{meta.to} of {meta.total} {noun}
      </span>
      <div className="flex items-center gap-2">
        {meta.page > 1 ? (
          <Link href={href(meta.page - 1)} scroll={false} className={`${btn} text-ink hover:bg-hover`}>Previous</Link>
        ) : (
          <span aria-disabled className={`${btn} opacity-40`}>Previous</span>
        )}
        <span className="tabular-nums">Page {meta.page} of {meta.pages}</span>
        {meta.page < meta.pages ? (
          <Link href={href(meta.page + 1)} scroll={false} className={`${btn} text-ink hover:bg-hover`}>Next</Link>
        ) : (
          <span aria-disabled className={`${btn} opacity-40`}>Next</span>
        )}
      </div>
    </nav>
  );
}

/** Same footer for lists paged in memory (client components, modals). */
export function LocalPager({ meta, onPage, noun = "rows" }: { meta: Meta; onPage: (page: number) => void; noun?: string }) {
  if (meta.pages <= 1) return null;
  const btn = "rounded-md border border-line px-3 py-1.5 text-xs text-ink transition-colors hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <nav aria-label="Pagination" className="mt-3 flex items-center justify-between gap-3 text-xs text-ink-subtle">
      <span className="tabular-nums">
        {meta.from}-{meta.to} of {meta.total} {noun}
      </span>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>Previous</button>
        <span className="tabular-nums">Page {meta.page} of {meta.pages}</span>
        <button type="button" className={btn} disabled={meta.page >= meta.pages} onClick={() => onPage(meta.page + 1)}>Next</button>
      </div>
    </nav>
  );
}
