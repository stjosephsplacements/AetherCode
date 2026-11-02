export const PAGE_SIZE = 25;

export type Paged<T> = {
  rows: T[];
  page: number;
  pages: number;
  total: number;
  /** 1-based index of the first and last row shown, 0 when empty */
  from: number;
  to: number;
};

/** Slice a list for one page. Out-of-range or junk page values clamp into range. */
export function paginate<T>(items: readonly T[], rawPage: string | number | undefined, size = PAGE_SIZE): Paged<T> {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const parsed = typeof rawPage === "number" ? rawPage : Number.parseInt(rawPage ?? "1", 10);
  const page = Number.isFinite(parsed) ? Math.min(Math.max(1, Math.trunc(parsed)), pages) : 1;
  const start = (page - 1) * size;
  const rows = items.slice(start, start + size);
  return { rows, page, pages, total, from: rows.length ? start + 1 : 0, to: start + rows.length };
}
