import Link from "next/link";
import { cx, buttonClass } from "./ui";

interface PaginationProps {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
}

export function Pagination({ page, totalPages, buildHref }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = pageRange(page, totalPages);

  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-1 pt-6">
      {page > 1 ? (
        <Link href={buildHref(page - 1)} className={cx(buttonClass("ghost", "sm"), "px-3")}>
          &larr; Prev
        </Link>
      ) : (
        <span className={cx(buttonClass("ghost", "sm"), "pointer-events-none px-3 opacity-40")}>&larr; Prev</span>
      )}

      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`ellipsis-${i}`} className="px-1.5 text-sm text-muted">&hellip;</span>
        ) : p === page ? (
          <span key={p} className={cx(buttonClass("secondary", "sm"), "pointer-events-none min-w-[2rem] px-2 text-center")}>
            {p}
          </span>
        ) : (
          <Link key={p} href={buildHref(p)} className={cx(buttonClass("ghost", "sm"), "min-w-[2rem] px-2 text-center")}>
            {p}
          </Link>
        ),
      )}

      {page < totalPages ? (
        <Link href={buildHref(page + 1)} className={cx(buttonClass("ghost", "sm"), "px-3")}>
          Next &rarr;
        </Link>
      ) : (
        <span className={cx(buttonClass("ghost", "sm"), "pointer-events-none px-3 opacity-40")}>Next &rarr;</span>
      )}
    </nav>
  );
}

function pageRange(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "...")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push("...");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push("...");
  pages.push(total);
  return pages;
}
