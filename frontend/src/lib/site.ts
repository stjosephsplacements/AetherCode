/** Facts the public pages state, in one place so they never disagree. */
export const SITE = {
  name: "AetherCode",
  operator: "AetherCode by AlgoQX & St. Joseph's Placements and Training Cell (St. Joseph's Group of Institutions)",
  operatorShort: "AlgoQX & St. Joseph's Placements and Training Cell",
  tagline: "Let your code do the talking.",
  description: "Coding exams and practice for colleges: timed exams, sandboxed judging, Safe Exam Browser lockdown and results staff can trust.",
  license: "Proprietary software. All rights reserved.",
  stats: { students: "10K+", runs: "1 lakh+" },
  /** Kept in step with judge-languages.sh. */
  languages: ["C", "C++17", "Java", "Python 3", "JavaScript", "Go"],
  /** The last time the legal pages changed. */
  legalUpdated: "28 October 2026",
} as const;

/** Public pages, for the sitemap and the proxy's allowlist. */
export const PUBLIC_PATHS = [
  "/about",
  "/u",
  "/architecture",
  "/changelog",
  "/help",
  "/privacy",
  "/security",
  "/status",
  "/system-check",
  "/terms",
] as const;
