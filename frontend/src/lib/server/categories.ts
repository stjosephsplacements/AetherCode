import "server-only";
import type { Category } from "@/lib/api-types";
import { gateway } from "./gateway";

export type TagSuggestion = { name: string; count: number };

/**
 * Every category with its question count. Empty when the question bank predates
 * categories (a rolling deploy), in which case the console works without them.
 */
export async function listCategories(): Promise<Category[]> {
  try {
    return (await gateway<{ categories: Category[] }>("/question-bank/v1/categories")).categories ?? [];
  } catch {
    return [];
  }
}

/** Tags in use, most used first, to suggest while an author types. */
export async function listTagSuggestions(limit = 200): Promise<TagSuggestion[]> {
  try {
    return (await gateway<{ tags: TagSuggestion[] }>(`/question-bank/v1/tags?limit=${limit}`)).tags ?? [];
  } catch {
    return [];
  }
}
