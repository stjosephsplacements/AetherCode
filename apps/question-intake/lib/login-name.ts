/** Staff are told to sign in as "hope1@stjosephs"; the platform's username is the part before the "@stjosephs" suffix. */
export function loginName(identifier: string): string {
  return identifier.trim().replace(/@stjosephs$/i, "");
}
