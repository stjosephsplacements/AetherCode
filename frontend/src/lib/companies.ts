/**
 * Company packs are question tags named `company:<name>` (ADR-0081): `company:tcs`,
 * `company:zoho`. No table backs them; placement staff tag a question, and the
 * question board and the exam builder filter on it.
 */
export const COMPANY_PREFIX = "company:";

export const isCompanyTag = (tag: string): boolean => tag.startsWith(COMPANY_PREFIX) && tag.length > COMPANY_PREFIX.length;

/** `company:tcs` reads as "tcs"; the select shows it capitalised by CSS. */
export const companyName = (tag: string): string => tag.slice(COMPANY_PREFIX.length);

/** The companies named by any of these tag lists, sorted. */
export function companiesIn(tagLists: string[][]): string[] {
  return [...new Set(tagLists.flatMap((tags) => tags.filter(isCompanyTag)))].sort();
}

/** True when no company is chosen or the tags include it. */
export const matchesCompany = (tags: string[], company: string): boolean => company === "all" || tags.includes(company);
