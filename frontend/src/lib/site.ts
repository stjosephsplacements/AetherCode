/** Facts the public pages state, in one place so they never disagree. */
export const SITE = {
  name: "AetherCode",
  operator: "AetherCode by AlgoQX & St. Joseph's Placements and Training Cell (St. Joseph's Group of Institutions)",
  operatorShort: "AlgoQX & St. Joseph's Placements and Training Cell",
  tagline: "Let your code do the talking.",
  description: "Open-source coding assessments for colleges: timed exams, sandboxed judging, Safe Exam Browser lockdown and results staff can trust.",
  repo: "https://github.com/AlgoQX/AetherCode",
  advisories: "https://github.com/AlgoQX/AetherCode/security/advisories/new",
  /** The sandboxed execution engine that runs every submission (ADR-0028). */
  engineRepo: "https://github.com/stjosephsplacements/AetherCode-Execution-Engine",
  license: "GNU AGPL v3",
  stats: { students: "10K+", runs: "1 lakh+" },
  /** Kept in step with judge-languages.sh. */
  languages: ["C", "C++17", "Java", "Python 3", "JavaScript", "Go"],
  /** The last time the legal pages changed. */
  legalUpdated: "28 October 2026",
} as const;

/** Public pages, for the sitemap and the proxy's allowlist. */
export const PUBLIC_PATHS = [
  "/about",
  "/architecture",
  "/changelog",
  "/help",
  "/privacy",
  "/security",
  "/status",
  "/system-check",
  "/terms",
] as const;
