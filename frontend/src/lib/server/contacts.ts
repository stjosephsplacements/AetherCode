import "server-only";

/**
 * Addresses each deployment publishes, from its environment. A page shows a
 * contact only when it is set, so self-hosted copies never point at ours.
 */
export type Contacts = {
  /** Help with accounts and exams. */
  support: string | null;
  /** The grievance officer the DPDP Act requires a data fiduciary to name. */
  grievance: string | null;
  /** Where vulnerability reports go; GitHub advisories when unset. */
  security: string | null;
};

const email = (name: string) => {
  const value = process.env[name]?.trim();
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
};

export function contacts(): Contacts {
  return { support: email("SUPPORT_EMAIL"), grievance: email("GRIEVANCE_EMAIL"), security: email("SECURITY_EMAIL") };
}
