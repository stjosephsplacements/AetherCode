/** Keyset page helpers for staff webcam galleries (matches submission list_snapshots cap). */

export const SNAPSHOT_PAGE_SIZE = 200;

export function pageExhausted(fetched: number, pageSize: number): boolean {
  return fetched < pageSize;
}

export function appendPage<T>(current: readonly T[], next: readonly T[], pageSize: number): {
  items: T[];
  exhausted: boolean;
} {
  return { items: [...current, ...next], exhausted: pageExhausted(next.length, pageSize) };
}
