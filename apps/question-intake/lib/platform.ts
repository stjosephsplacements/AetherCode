/**
 * The question bank's own rules, copied from the platform so that what is saved here imports without a change:
 * frontend/src/components/staff/question-wizard/model.ts and backend/services/question-bank.
 */
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const KINDS = ["coding", "mcq"] as const;
export type Kind = (typeof KINDS)[number];

/** A slug is 3 to 80 characters of a-z, 0-9 and hyphens. */
export const SLUG = /^[a-z0-9-]{3,80}$/;

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
}

export const MAX_TAGS = 50;
export const MAX_TAG_LENGTH = 80;

/** A tag as the question bank stores it: lower case, no padding, words joined by hyphens. */
export const normalizeTag = (raw: string): string =>
  raw.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^\p{L}\p{N}+#.-]/gu, "").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, MAX_TAG_LENGTH);

export const cleanTags = (tags: string[]): string[] => [...new Set(tags.map(normalizeTag).filter(Boolean))].slice(0, MAX_TAGS);

/** A category name: trimmed, 1 to 80 characters, no control characters; unique among its siblings, ignoring case. */
export const normalizeCategory = (name: string) => name.trim().toLowerCase();
export const validCategoryName = (name: string) => name === name.trim() && name.length >= 1 && name.length <= 80 && !/[\u0000-\u001f\u007f]/.test(name);

/** The judge compares whole lines, so every saved test value ends in a newline. */
export const withNewline = (value: string) => (value === "" || value.endsWith("\n") ? value : `${value}\n`);

export const LIMITS = { timeMs: { min: 50, max: 600_000 }, memoryKib: { min: 1024, max: 4_194_304 }, weight: { min: 1, max: 100 }, title: 300, explanation: 1000 } as const;
