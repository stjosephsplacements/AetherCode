import "server-only";
import type { ProfileLink } from "@/lib/api-types";
import { parseCodeforcesContests, parseCodeforcesUser, parseGithubIssues, parseGithubUser, parseLeetcodeSolved, type ListingDraft } from "@/lib/external";

const HEADERS = { "user-agent": "AetherCode (+https://aethercode.stjosephsplacements.in)", accept: "application/json" };

/** A public JSON endpoint, or null when it is slow, down or refuses (these are best effort). */
async function fetchJson(url: string, init: RequestInit = {}, revalidate = 0): Promise<unknown> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { ...HEADERS, ...init.headers },
      signal: AbortSignal.timeout(6000),
      ...(revalidate ? { next: { revalidate } } : { cache: "no-store" as const }),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function upcomingCodeforcesContests(): Promise<ListingDraft[] | null> {
  const payload = await fetchJson("https://codeforces.com/api/contest.list?gym=false");
  return payload ? parseCodeforcesContests(payload) : null;
}

export async function goodFirstIssues(): Promise<ListingDraft[] | null> {
  const query = encodeURIComponent('label:"good first issue" state:open is:issue is:public');
  const payload = await fetchJson(`https://api.github.com/search/issues?q=${query}&sort=updated&per_page=20`);
  return payload ? parseGithubIssues(payload) : null;
}

export type PlatformStat = { platform: ProfileLink["platform"]; handle: string; url: string; lines: string[] | null };

const PROFILE_URL: Record<ProfileLink["platform"], (handle: string) => string> = {
  leetcode: (handle) => `https://leetcode.com/u/${handle}/`,
  github: (handle) => `https://github.com/${handle}`,
  codeforces: (handle) => `https://codeforces.com/profile/${handle}`,
  codechef: (handle) => `https://www.codechef.com/users/${handle}`,
  hackerrank: (handle) => `https://www.hackerrank.com/profile/${handle}`,
  atcoder: (handle) => `https://atcoder.jp/users/${handle}`,
  skillrack: (handle) => `https://www.skillrack.com/faces/resume.xhtml?id=${handle}`,
};

/**
 * Public numbers for a student's linked accounts, cached for an hour. CodeChef
 * and HackerRank have no public API, so they show the link only; a platform
 * that does not answer shows its link and no numbers.
 */
export async function platformStats(links: ProfileLink[]): Promise<PlatformStat[]> {
  return Promise.all(
    links.map(async ({ platform, handle }) => {
      const encoded = encodeURIComponent(handle);
      let lines: string[] | null = null;
      if (platform === "codeforces") {
        const user = parseCodeforcesUser(await fetchJson(`https://codeforces.com/api/user.info?handles=${encoded}`, {}, 3600));
        if (user) lines = [user.rating !== null ? `Rating ${user.rating} (max ${user.maxRating})` : "Unrated", user.rank ? `Rank ${user.rank}` : ""].filter(Boolean);
      } else if (platform === "github") {
        const user = parseGithubUser(await fetchJson(`https://api.github.com/users/${encoded}`, {}, 3600));
        if (user) lines = [`${user.repos} public repositories`, `${user.followers} followers`];
      } else if (platform === "leetcode") {
        const solved = parseLeetcodeSolved(
          await fetchJson(
            "https://leetcode.com/graphql",
            {
              method: "POST",
              headers: { "content-type": "application/json", referer: "https://leetcode.com" },
              body: JSON.stringify({
                query: "query($username: String!) { matchedUser(username: $username) { submitStats { acSubmissionNum { difficulty count } } } }",
                variables: { username: handle },
              }),
            },
            3600,
          ),
        );
        if (solved) lines = [`${solved.total} solved`, `${solved.easy} easy, ${solved.medium} medium, ${solved.hard} hard`];
      } else if (platform === "atcoder") {
        const atcoderRank = await fetchJson(`https://kenkoooo.com/atcoder/atcoder-api/v3/user/ac_rank?user=${encoded}`, {}, 3600) as { count?: number } | null;
        if (atcoderRank && typeof atcoderRank.count === "number") {
          lines = [`${atcoderRank.count} problems solved`];
        }
      } else if (platform === "skillrack") {
        try {
          const res = await fetch(`https://www.skillrack.com/faces/resume.xhtml?id=${encoded}`, {
            headers: HEADERS,
            signal: AbortSignal.timeout(6000),
            next: { revalidate: 3600 },
          });
          if (res.ok) {
            const html = await res.text();
            const match =
              html.match(/PROGRAMS SOLVED[\s\S]*?<\/i>(\d+)/i) ||
              html.match(/programs?\s*solved[:\s]*([0-9,]+)/i);
            if (match && match[1]) {
              lines = [`${match[1]} programs solved`];
            }
          }
        } catch {
          // best-effort fallback: links only
        }
      }
      return { platform, handle, url: PROFILE_URL[platform](encoded), lines };
    }),
  );
}
