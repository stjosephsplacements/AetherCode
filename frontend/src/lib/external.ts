import type { FeedKind } from "@/lib/api-types";

/** A listing ready to save with PUT …/community/moderation/feed. */
export type ListingDraft = {
  kind: FeedKind;
  title: string;
  description?: string;
  url: string;
  platform: string;
  starts_at?: string;
  ends_at?: string;
  tags: string[];
  external_id: string;
};

type CodeforcesContest = { id: number; name: string; type?: string; phase: string; durationSeconds: number; startTimeSeconds?: number };

/** Codeforces' public contest list (contest.list): upcoming contests, soonest first. */
export function parseCodeforcesContests(payload: unknown, limit = 30): ListingDraft[] {
  const result = (payload as { status?: string; result?: CodeforcesContest[] } | null)?.result;
  if (!Array.isArray(result)) return [];
  return result
    .filter((contest) => contest.phase === "BEFORE" && typeof contest.startTimeSeconds === "number")
    .sort((a, b) => a.startTimeSeconds! - b.startTimeSeconds!)
    .slice(0, limit)
    .map((contest) => ({
      kind: "contest" as const,
      title: contest.name,
      url: `https://codeforces.com/contests/${contest.id}`,
      platform: "Codeforces",
      starts_at: new Date(contest.startTimeSeconds! * 1000).toISOString(),
      ends_at: new Date((contest.startTimeSeconds! + contest.durationSeconds) * 1000).toISOString(),
      tags: contest.type ? [contest.type.toLowerCase()] : [],
      external_id: `cf-${contest.id}`,
    }));
}

type GithubIssue = { id: number; title: string; html_url: string; body?: string | null; repository_url: string; labels?: { name?: string }[] };

/** GitHub's issue search for "good first issue": open issues in public repositories. */
export function parseGithubIssues(payload: unknown, limit = 20): ListingDraft[] {
  const items = (payload as { items?: GithubIssue[] } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items.slice(0, limit).map((issue) => {
    const repository = issue.repository_url.replace("https://api.github.com/repos/", "");
    return {
      kind: "opensource" as const,
      title: issue.title.slice(0, 300),
      description: `${repository}: ${(issue.body ?? "").replace(/\s+/g, " ").trim().slice(0, 300)}`.trim(),
      url: issue.html_url,
      platform: "GitHub",
      tags: (issue.labels ?? []).map((label) => label.name ?? "").filter(Boolean).slice(0, 5).map((name) => name.slice(0, 30)),
      external_id: `gh-${issue.id}`,
    };
  });
}

/** Rating and rank from Codeforces' user.info. */
export function parseCodeforcesUser(payload: unknown): { rating: number | null; maxRating: number | null; rank: string | null } | null {
  const user = (payload as { result?: { rating?: number; maxRating?: number; rank?: string }[] } | null)?.result?.[0];
  if (!user) return null;
  return { rating: user.rating ?? null, maxRating: user.maxRating ?? null, rank: user.rank ?? null };
}

/** Public numbers from GitHub's users API. */
export function parseGithubUser(payload: unknown): { repos: number; followers: number } | null {
  const user = payload as { public_repos?: number; followers?: number } | null;
  if (typeof user?.public_repos !== "number") return null;
  return { repos: user.public_repos, followers: user.followers ?? 0 };
}

/** Solved counts from LeetCode's GraphQL matchedUser query. */
export function parseLeetcodeSolved(payload: unknown): { easy: number; medium: number; hard: number; total: number } | null {
  const rows = (payload as { data?: { matchedUser?: { submitStats?: { acSubmissionNum?: { difficulty: string; count: number }[] } } | null } } | null)?.data?.matchedUser?.submitStats?.acSubmissionNum;
  if (!Array.isArray(rows)) return null;
  const count = (name: string) => rows.find((row) => row.difficulty === name)?.count ?? 0;
  return { easy: count("Easy"), medium: count("Medium"), hard: count("Hard"), total: count("All") };
}
