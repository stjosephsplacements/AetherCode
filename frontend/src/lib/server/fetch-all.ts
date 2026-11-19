import "server-only";
import type { Page } from "@/lib/api-types";
import { gateway } from "./gateway";

/** Requests of 100 records each: 10 000 records, far above any college; past it the list fails loudly instead of being cut silently. */
export const MAX_PAGES = 100;

/** Every record behind a cursor-paged list route, following next_cursor. `path` may carry its own query. */
export async function fetchAllPages<T>(path: string, options: { headers?: Record<string, string> } = {}): Promise<T[]> {
  const items: T[] = [];
  let cursor = "";
  for (let request = 0; request < MAX_PAGES; request++) {
    const separator = path.includes("?") ? "&" : "?";
    const result = await gateway<Page<T>>(`${path}${separator}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, options);
    items.push(...result.items);
    if (!result.next_cursor) return items;
    cursor = result.next_cursor;
  }
  throw new Error(`${path} has more than ${MAX_PAGES * 100} records; refusing to show a truncated list`);
}
