import type { CategoryRef } from "@/lib/api-types";

/** Each top-level category followed by its sub-categories, in the order given. A child whose parent is missing counts as top level. */
export function inFolderOrder<T extends CategoryRef>(categories: T[]): { category: T; depth: 0 | 1; label: string }[] {
  const ids = new Set(categories.map((category) => category.id));
  const topLevel = categories.filter((category) => !category.parent_id || !ids.has(category.parent_id));
  return topLevel.flatMap((parent) => [
    { category: parent, depth: 0 as const, label: parent.name },
    ...categories.filter((child) => child.parent_id === parent.id).map((child) => ({ category: child, depth: 1 as const, label: `${parent.name} / ${child.name}` })),
  ]);
}
