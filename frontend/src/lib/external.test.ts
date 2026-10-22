import { describe, expect, it } from "vitest";
import { parseCodeforcesContests, parseCodeforcesUser, parseGithubIssues, parseGithubUser, parseLeetcodeSolved } from "./external";

describe("external listings", () => {
  it("keeps upcoming Codeforces contests, soonest first", () => {
    const listings = parseCodeforcesContests({
      status: "OK",
      result: [
        { id: 3, name: "Later", type: "ICPC", phase: "BEFORE", durationSeconds: 7200, startTimeSeconds: 2000 },
        { id: 1, name: "Done", phase: "FINISHED", durationSeconds: 7200, startTimeSeconds: 100 },
        { id: 2, name: "Soon", type: "CF", phase: "BEFORE", durationSeconds: 3600, startTimeSeconds: 1000 },
      ],
    });
    expect(listings.map((listing) => listing.title)).toEqual(["Soon", "Later"]);
    expect(listings[0]).toMatchObject({ kind: "contest", url: "https://codeforces.com/contests/2", external_id: "cf-2", tags: ["cf"] });
    expect(listings[0]!.ends_at).toBe(new Date(4600 * 1000).toISOString());
  });

  it("turns GitHub issues into open-source listings", () => {
    const [issue] = parseGithubIssues({
      items: [{ id: 9, title: "Fix typo", html_url: "https://github.com/a/b/issues/1", body: "line one\n\nline two", repository_url: "https://api.github.com/repos/a/b", labels: [{ name: "good first issue" }] }],
    });
    expect(issue).toMatchObject({ kind: "opensource", external_id: "gh-9", platform: "GitHub", tags: ["good first issue"] });
    expect(issue!.description).toBe("a/b: line one line two");
  });

  it("returns nothing for payloads it does not understand", () => {
    expect(parseCodeforcesContests(null)).toEqual([]);
    expect(parseGithubIssues({})).toEqual([]);
    expect(parseCodeforcesUser({ result: [] })).toBeNull();
    expect(parseGithubUser({ message: "Not Found" })).toBeNull();
    expect(parseLeetcodeSolved({ data: { matchedUser: null } })).toBeNull();
  });

  it("reads platform statistics", () => {
    expect(parseCodeforcesUser({ result: [{ rating: 1400, maxRating: 1500, rank: "specialist" }] })).toEqual({ rating: 1400, maxRating: 1500, rank: "specialist" });
    expect(parseGithubUser({ public_repos: 12, followers: 3 })).toEqual({ repos: 12, followers: 3 });
    expect(parseLeetcodeSolved({ data: { matchedUser: { submitStats: { acSubmissionNum: [{ difficulty: "All", count: 30 }, { difficulty: "Easy", count: 20 }, { difficulty: "Hard", count: 2 }] } } } })).toEqual({ easy: 20, medium: 0, hard: 2, total: 30 });
  });
});
