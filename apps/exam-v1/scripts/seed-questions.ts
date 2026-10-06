/**
 * Seed 30 medium competitive-programming questions with 20 test cases each
 * (2 sample + 18 hidden).  Topics: Greedy, DFS/BFS, Sliding Window, DP,
 * Two Pointers, Binary Search, Graphs, Backtracking, Prefix Sum, Trees.
 *
 * Usage: pnpm tsx scripts/seed-questions.ts
 * Requires DATABASE_URL in env (same as the rest of the app).
 */

import { sql } from "../lib/db.ts";

interface TestCase {
  input: string;
  output: string;
  is_sample: boolean;
}

interface Question {
  title: string;
  statement: string; // supports MathJax via $...$ and $$...$$
  time_limit_ms: number;
  memory_limit_kb: number;
  test_cases: TestCase[];
}

// ---------------------------------------------------------------------------
// Helper: wrap 2 sample + 18 hidden cases into the TestCase array shape
// ---------------------------------------------------------------------------
function cases(
  samples: [string, string][],
  hidden: [string, string][]
): TestCase[] {
  return [
    ...samples.map(([input, output]) => ({ input, output, is_sample: true })),
    ...hidden.map(([input, output]) => ({ input, output, is_sample: false })),
  ];
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------
const QUESTIONS: Question[] = [
  // ── 1. GREEDY ─────────────────────────────────────────────────────────────
  {
    title: "Coin Change (Greedy)",
    statement: `Given an amount $N$ and coins of denominations $1, 5, 10, 25$, find the **minimum number of coins** needed to make exactly $N$ cents.

**Input Format**
A single integer $N$ ($1 \\le N \\le 10^4$).

**Output Format**
A single integer — the minimum number of coins.

**Sample Input 1**
\`\`\`
41
\`\`\`
**Sample Output 1**
\`\`\`
4
\`\`\`
*Explanation:* $25 + 10 + 5 + 1 = 41$, using 4 coins.`,
    time_limit_ms: 1000,
    memory_limit_kb: 65536,
    test_cases: cases(
      [["41", "4"], ["100", "4"]],
      [
        ["1", "1"], ["5", "1"], ["10", "1"], ["25", "1"],
        ["30", "2"], ["36", "3"], ["99", "9"], ["50", "2"],
        ["7", "3"], ["13", "3"], ["200", "8"], ["1000", "40"],
        ["9999", "399"], ["10000", "400"], ["76", "5"], ["88", "6"],
        ["63", "5"], ["49", "5"],
      ]
    ),
  },

  // ── 2. GREEDY ─────────────────────────────────────────────────────────────
  {
    title: "Activity Selection",
    statement: `You are given $N$ activities with start time $s_i$ and end time $e_i$ ($s_i < e_i$). Select the **maximum number of non-overlapping activities** (two activities overlap if one starts strictly before the other ends).

**Input Format**
First line: integer $N$ ($1 \\le N \\le 10^5$).
Next $N$ lines: two integers $s_i\\ e_i$ ($0 \\le s_i < e_i \\le 10^9$).

**Output Format**
A single integer — the maximum number of activities.

**Sample Input 1**
\`\`\`
6
1 3
2 5
3 9
6 8
5 7
8 11
\`\`\`
**Sample Output 1**
\`\`\`
4
\`\`\``,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["6\n1 3\n2 5\n3 9\n6 8\n5 7\n8 11", "4"],
        ["1\n0 1", "1"],
      ],
      [
        ["3\n1 2\n2 3\n3 4", "3"],
        ["4\n1 10\n2 3\n4 5\n6 7", "3"],
        ["5\n0 5\n1 3\n2 4\n3 5\n4 6", "2"],
        ["2\n0 1000000000\n0 1000000000", "1"],
        ["10\n1 2\n3 4\n5 6\n7 8\n9 10\n11 12\n13 14\n15 16\n17 18\n19 20", "10"],
        ["5\n1 100\n2 3\n4 5\n6 7\n8 9", "4"],
        ["7\n0 1\n0 2\n0 3\n0 4\n0 5\n0 6\n0 7", "1"],
        ["4\n1 3\n2 4\n3 5\n4 6", "2"],
        ["3\n0 3\n1 2\n2 3", "2"],
        ["6\n10 20\n15 25\n20 30\n25 35\n30 40\n35 45", "3"],
        ["2\n0 5\n5 10", "2"],
        ["5\n1 4\n2 5\n3 6\n4 7\n5 8", "2"],
        ["3\n1 2\n1 3\n1 4", "1"],
        ["8\n0 10\n1 2\n3 4\n5 6\n7 8\n9 11\n11 12\n12 13", "6"],
        ["4\n0 1\n2 3\n4 5\n6 7", "4"],
        ["3\n5 10\n1 6\n8 12", "2"],
        ["6\n1 5\n2 3\n4 6\n5 7\n6 8\n7 9", "3"],
        ["2\n0 100\n50 60", "1"],
      ]
    ),
  },

  // ── 3. GREEDY ─────────────────────────────────────────────────────────────
  {
    title: "Jump Game",
    statement: `You are given an array $a$ of $N$ non-negative integers. Starting at index $0$, at each position $i$ you can jump at most $a[i]$ steps forward. Determine if you can reach the last index.

Print \`YES\` if reachable, \`NO\` otherwise.

**Input Format**
First line: $N$ ($1 \\le N \\le 10^5$).
Second line: $N$ space-separated integers $a_i$ ($0 \\le a_i \\le 10^5$).

**Sample Input 1**
\`\`\`
5
2 3 1 1 4
\`\`\`
**Sample Output 1**
\`\`\`
YES
\`\`\``,
    time_limit_ms: 1000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["5\n2 3 1 1 4", "YES"],
        ["5\n3 2 1 0 4", "NO"],
      ],
      [
        ["1\n0", "YES"],
        ["2\n0 1", "NO"],
        ["3\n1 1 0", "YES"],
        ["4\n0 2 3 0", "NO"],
        ["6\n5 0 0 0 0 1", "YES"],
        ["5\n1 1 1 1 1", "YES"],
        ["5\n0 0 0 0 0", "NO"],
        ["3\n2 0 0", "YES"],
        ["7\n4 0 0 0 3 0 0", "YES"],
        ["8\n2 3 0 1 4 0 0 0", "YES"],
        ["4\n1 0 1 0", "NO"],
        ["6\n1 2 0 0 1 0", "NO"],
        ["10\n10 0 0 0 0 0 0 0 0 0", "YES"],
        ["3\n0 1 0", "NO"],
        ["5\n1 0 2 0 1", "NO"],
        ["6\n2 5 0 0 0 0", "YES"],
        ["5\n1 1 0 1 0", "NO"],
        ["2\n1 0", "YES"],
      ]
    ),
  },

  // ── 4. SLIDING WINDOW ─────────────────────────────────────────────────────
  {
    title: "Maximum Sum Subarray of Size K",
    statement: `Given an array of $N$ integers and an integer $K$, find the **maximum sum** of any contiguous subarray of size exactly $K$.

**Input Format**
First line: $N\\ K$ ($1 \\le K \\le N \\le 10^6$, $1 \\le K \\le 10^5$).
Second line: $N$ space-separated integers ($-10^4 \\le a_i \\le 10^4$).

**Output Format**
A single integer.

**Sample Input 1**
\`\`\`
7 3
2 1 5 1 3 2 -1
\`\`\`
**Sample Output 1**
\`\`\`
9
\`\`\``,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["7 3\n2 1 5 1 3 2 -1", "9"],
        ["5 1\n-3 -2 -1 0 1", "1"],
      ],
      [
        ["5 5\n1 2 3 4 5", "15"],
        ["6 2\n1 2 3 4 5 6", "11"],
        ["4 2\n-1 -2 -3 -4", "-3"],
        ["8 4\n1 -2 3 -1 5 -3 2 4", "7"],
        ["3 2\n100 -100 100", "0"],
        ["10 3\n5 5 5 5 5 5 5 5 5 5", "15"],
        ["6 3\n1 -1 1 -1 1 -1", "1"],
        ["7 2\n3 -4 5 -2 6 -1 2", "5"],
        ["5 3\n0 0 0 0 0", "0"],
        ["9 4\n10 20 30 40 50 60 70 80 90", "330"],
        ["4 3\n-5 -3 -1 -2", "-6"],
        ["6 1\n7 3 9 1 8 2", "9"],
        ["5 4\n2 -1 2 -1 2", "2"],
        ["7 5\n1 2 3 4 5 6 7", "25"],
        ["5 2\n1000 -1000 1000 -1000 1000", "0"],
        ["6 3\n4 -2 1 3 -1 5", "7"],
        ["3 1\n-9 -5 -1", "-1"],
        ["8 3\n2 4 6 8 10 12 14 16", "42"],
      ]
    ),
  },

  // ── 5. SLIDING WINDOW ─────────────────────────────────────────────────────
  {
    title: "Longest Substring Without Repeating Characters",
    statement: `Given a string $S$ of length $N$ (lowercase English letters), find the **length of the longest substring** without repeating characters.

**Input Format**
A single string $S$ ($1 \\le |S| \\le 10^5$).

**Output Format**
A single integer.

**Sample Input 1**
\`\`\`
abcabcbb
\`\`\`
**Sample Output 1**
\`\`\`
3
\`\`\``,
    time_limit_ms: 1000,
    memory_limit_kb: 65536,
    test_cases: cases(
      [["abcabcbb", "3"], ["bbbbb", "1"]],
      [
        ["pwwkew", "3"],
        ["a", "1"],
        ["abcdefg", "7"],
        ["aab", "2"],
        ["dvdf", "3"],
        ["anviaj", "5"],
        ["tmmzuxt", "5"],
        ["aabbcc", "2"],
        ["abba", "2"],
        ["abcdeabcde", "5"],
        ["aaaaaaaaaa", "1"],
        ["abcbda", "4"],
        ["qwerty", "6"],
        ["zxcvbnm", "7"],
        ["abcdabef", "6"],
        ["azbzcz", "3"],
        ["abacaba", "3"],
        ["xyzxyz", "3"],
      ]
    ),
  },

  // ── 6. SLIDING WINDOW ─────────────────────────────────────────────────────
  {
    title: "Minimum Window Substring",
    statement: `Given strings $S$ and $T$, find the **minimum length contiguous substring** of $S$ that contains all characters of $T$ (including duplicates). If no such substring exists, print \`-1\`.

**Input Format**
First line: string $S$ ($1 \\le |S| \\le 10^5$).
Second line: string $T$ ($1 \\le |T| \\le 100$).

**Output Format**
The minimum length, or $-1$.

**Sample Input 1**
\`\`\`
ADOBECODEBANC
ABC
\`\`\`
**Sample Output 1**
\`\`\`
4
\`\`\``,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [["ADOBECODEBANC\nABC", "4"], ["a\na", "1"]],
      [
        ["a\nb", "-1"],
        ["aa\naa", "2"],
        ["abc\ncba", "3"],
        ["AABBCC\nABC", "3"],
        ["xyzabcxyz\nabc", "3"],
        ["abcdef\nfed", "6"],
        ["aaabbc\nabc", "4"],
        ["abcabc\nabc", "3"],
        ["a\naa", "-1"],
        ["aaaaaa\na", "1"],
        ["bdab\nab", "2"],
        ["ABCDEFGH\nHAF", "8"],
        ["cabwefgewcwaefgcf\ncae", "4"],
        ["bba\nab", "2"],
        ["abcde\nace", "5"],
        ["aaflslflsldkalskaaa\naaa", "11"],
        ["abc\nac", "3"],
        ["acbbaca\naba", "4"],
      ]
    ),
  },

  // ── 7. TWO POINTERS ───────────────────────────────────────────────────────
  {
    title: "Two Sum – Sorted Array",
    statement: `Given a sorted array of $N$ integers and a target $T$, find two distinct indices $i < j$ such that $a_i + a_j = T$. Print the **1-indexed** pair. Guaranteed exactly one solution exists.

**Input Format**
First line: $N\\ T$ ($2 \\le N \\le 10^5$, $-10^9 \\le T \\le 10^9$).
Second line: $N$ space-separated integers in non-decreasing order.

**Output Format**
Two space-separated integers $i\\ j$.

**Sample Input 1**
\`\`\`
4 9
2 7 11 15
\`\`\`
**Sample Output 1**
\`\`\`
1 2
\`\`\``,
    time_limit_ms: 1000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [["4 9\n2 7 11 15", "1 2"], ["4 6\n1 2 3 4", "2 4"]],
      [
        ["2 3\n1 2", "1 2"],
        ["5 8\n1 2 3 5 8", "3 4"],
        ["6 10\n1 3 4 5 6 7", "3 5"],
        ["4 0\n-3 -1 1 3", "2 3"],
        ["4 -2\n-5 -3 1 2", "1 3"],
        ["5 100\n1 50 51 99 100", "2 3"],
        ["6 7\n1 2 3 4 5 6", "1 6"],
        ["3 20\n5 10 15", "2 3"],
        ["5 14\n2 4 6 8 10", "3 5"],
        ["4 12\n3 5 7 9", "2 4"],
        ["5 0\n-4 -2 0 2 4", "1 5"],
        ["6 9\n1 2 3 4 5 8", "1 5"],
        ["4 -4\n-8 -3 -1 0", "1 2"],
        ["5 11\n1 3 5 7 9", "2 4"],
        ["4 18\n4 7 9 11", "2 4"],
        ["3 8\n3 5 6", "1 2"],
        ["5 4\n-3 -1 0 2 7", "1 4"],
        ["4 15\n5 7 8 10", "2 4"],
      ]
    ),
  },

  // ── 8. TWO POINTERS ───────────────────────────────────────────────────────
  {
    title: "Container With Most Water",
    statement: `You are given $N$ non-negative integers $h_1, h_2, \\ldots, h_N$ representing vertical lines. The width between lines $i$ and $j$ is $|i - j|$. The water the container between lines $i$ and $j$ can hold is:
$$\\text{water}(i,j) = (j - i) \\times \\min(h_i, h_j)$$
Find the **maximum water** any container can hold.

**Input Format**
First line: $N$ ($2 \\le N \\le 10^5$).
Second line: $N$ space-separated integers $h_i$ ($0 \\le h_i \\le 10^4$).

**Sample Input 1**
\`\`\`
9
1 8 6 2 5 4 8 3 7
\`\`\`
**Sample Output 1**
\`\`\`
49
\`\`\``,
    time_limit_ms: 1000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["9\n1 8 6 2 5 4 8 3 7", "49"],
        ["2\n1 1", "1"],
      ],
      [
        ["2\n0 0", "0"],
        ["4\n1 2 3 4", "4"],
        ["5\n4 3 2 1 4", "16"],
        ["6\n1 2 4 3 1 5", "12"],
        ["3\n3 1 2", "4"],
        ["5\n2 3 4 5 18", "17"],
        ["6\n10000 1 1 1 1 10000", "50000"],
        ["4\n1 3 2 4", "4"],
        ["7\n1 1 1 1 1 1 1", "6"],
        ["5\n5 5 5 5 5", "20"],
        ["4\n0 10 0 10", "20"],
        ["6\n2 3 1 4 5 6", "15"],
        ["3\n10 9 8", "16"],
        ["8\n1 2 3 4 5 6 7 8", "16"],
        ["5\n8 2 2 2 8", "32"],
        ["4\n3 0 0 3", "9"],
        ["6\n1 0 0 0 0 1", "5"],
        ["3\n1000 0 1000", "1000"],
      ]
    ),
  },

  // ── 9. BINARY SEARCH ──────────────────────────────────────────────────────
  {
    title: "Koko Eating Bananas",
    statement: `Koko has $N$ piles of bananas. She eats at speed $k$ bananas per hour (finishing a pile in $\\lceil pile_i / k \\rceil$ hours). Find the **minimum integer speed** $k$ such that she can finish all piles within $H$ hours.

**Input Format**
First line: $N\\ H$ ($1 \\le N \\le 10^4$, $N \\le H \\le 10^9$).
Second line: $N$ space-separated integers $pile_i$ ($1 \\le pile_i \\le 10^9$).

**Output Format**
A single integer — minimum $k$.

**Sample Input 1**
\`\`\`
4 8
3 6 7 11
\`\`\`
**Sample Output 1**
\`\`\`
4
\`\`\``,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["4 8\n3 6 7 11", "4"],
        ["5 5\n30 11 23 4 20", "30"],
      ],
      [
        ["3 6\n1 1 1", "1"],
        ["4 4\n1 2 3 4", "4"],
        ["1 1\n1000000000", "1000000000"],
        ["3 10\n10 10 10", "10"],
        ["5 7\n1 1 1 1 1000000000", "142857143"],
        ["4 100\n3 6 7 11", "1"],
        ["3 3\n312884470 285765564 539962836", "539962836"],
        ["2 2\n100 100", "100"],
        ["6 6\n1 2 3 4 5 6", "6"],
        ["4 16\n3 6 7 11", "2"],
        ["3 9\n100 200 300", "100"],
        ["1 10\n100", "10"],
        ["5 5\n5 5 5 5 5", "5"],
        ["3 5\n2 4 6", "4"],
        ["4 12\n5 10 15 20", "10"],
        ["2 3\n10 10", "7"],
        ["3 4\n3 6 7", "6"],
        ["2 1000000000\n1 1", "1"],
      ]
    ),
  },

  // ── 10. BINARY SEARCH ─────────────────────────────────────────────────────
  {
    title: "Find Peak Element",
    statement: `A peak element is one that is **strictly greater than its neighbours**. Given an array of $N$ distinct integers, find **any** peak element's **0-indexed** position. Assume $a[-1] = a[N] = -\\infty$.

Your solution must run in $O(\\log N)$ time.

**Input Format**
First line: $N$ ($1 \\le N \\le 10^5$).
Second line: $N$ space-separated integers.

**Output Format**
A single integer — any valid peak index (multiple correct answers accepted).

**Sample Input 1**
\`\`\`
5
1 2 3 1 0
\`\`\`
**Sample Output 1**
\`\`\`
2
\`\`\``,
    time_limit_ms: 1000,
    memory_limit_kb: 65536,
    test_cases: cases(
      [
        ["5\n1 2 3 1 0", "2"],
        ["3\n1 2 1", "1"],
      ],
      [
        ["1\n5", "0"],
        ["4\n1 2 3 4", "3"],
        ["4\n4 3 2 1", "0"],
        ["5\n1 3 2 4 5", "4"],
        ["6\n6 5 4 3 2 1", "0"],
        ["6\n1 2 3 4 5 6", "5"],
        ["5\n3 1 2 4 5", "4"],
        ["7\n1 5 3 7 2 6 4", "3"],
        ["4\n2 1 3 4", "3"],
        ["5\n10 20 15 5 25", "4"],
        ["3\n3 2 1", "0"],
        ["6\n1 6 5 4 3 2", "1"],
        ["5\n1 2 5 3 4", "2"],
        ["4\n3 4 1 2", "1"],
        ["7\n2 4 6 8 7 5 3", "3"],
        ["3\n1 3 2", "1"],
        ["5\n5 4 3 2 1", "0"],
        ["6\n3 2 1 4 5 6", "5"],
      ]
    ),
  },

  // ── 11. DYNAMIC PROGRAMMING ───────────────────────────────────────────────
  {
    title: "Longest Increasing Subsequence",
    statement: `Given a sequence of $N$ integers, find the **length of the longest strictly increasing subsequence** (elements need not be contiguous).

**Input Format**
First line: $N$ ($1 \\le N \\le 10^5$).
Second line: $N$ space-separated integers ($-10^9 \\le a_i \\le 10^9$).

**Output Format**
A single integer.

**Sample Input 1**
\`\`\`
8
10 9 2 5 3 7 101 18
\`\`\`
**Sample Output 1**
\`\`\`
4
\`\`\``,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["8\n10 9 2 5 3 7 101 18", "4"],
        ["3\n0 1 0", "2"],
      ],
      [
        ["1\n5", "1"],
        ["5\n1 2 3 4 5", "5"],
        ["5\n5 4 3 2 1", "1"],
        ["6\n3 1 4 1 5 9", "4"],
        ["7\n1 3 2 4 3 5 4", "4"],
        ["9\n2 1 5 3 6 4 8 9 7", "6"],
        ["6\n1 1 1 1 1 1", "1"],
        ["8\n1 3 5 2 4 6 8 7", "5"],
        ["5\n10 20 30 20 50", "4"],
        ["7\n7 7 7 7 7 7 7", "1"],
        ["6\n4 2 1 3 5 6", "4"],
        ["10\n3 10 2 1 20 3 4 15 5 6", "5"],
        ["5\n50 3 10 7 40", "3"],
        ["4\n-3 -1 -2 0", "3"],
        ["6\n1 2 3 1 2 3", "3"],
        ["8\n5 1 4 2 8 3 9 7", "4"],
        ["5\n100 90 80 70 60", "1"],
        ["6\n3 6 2 7 1 5", "3"],
      ]
    ),
  },

  // ── 12. DYNAMIC PROGRAMMING ───────────────────────────────────────────────
  {
    title: "0/1 Knapsack",
    statement: `Given $N$ items each with weight $w_i$ and value $v_i$, and a knapsack of capacity $W$, find the **maximum total value** you can carry (each item can be taken at most once).

**Input Format**
First line: $N\\ W$ ($1 \\le N \\le 100$, $1 \\le W \\le 1000$).
Next $N$ lines: $w_i\\ v_i$ ($1 \\le w_i \\le W$, $1 \\le v_i \\le 10^4$).

**Output Format**
A single integer — maximum value.

**Sample Input 1**
\`\`\`
4 8
2 3
3 4
4 5
5 6
\`\`\`
**Sample Output 1**
\`\`\`
10
\`\`\``,
    time_limit_ms: 2000,
    memory_limit_kb: 65536,
    test_cases: cases(
      [
        ["4 8\n2 3\n3 4\n4 5\n5 6", "10"],
        ["3 50\n10 60\n20 100\n30 120", "220"],
      ],
      [
        ["1 5\n3 10", "10"],
        ["1 2\n3 10", "0"],
        ["3 10\n2 6\n2 10\n3 12", "28"],
        ["5 10\n1 1\n2 6\n3 10\n4 14\n5 18", "36"],
        ["4 7\n1 1\n3 4\n4 5\n5 7", "9"],
        ["3 6\n2 3\n3 4\n5 5", "7"],
        ["5 15\n3 4\n4 5\n5 6\n6 7\n7 8", "19"],
        ["2 3\n2 3\n2 3", "3"],
        ["4 10\n5 10\n4 40\n3 30\n2 50", "120"],
        ["6 50\n10 60\n20 100\n30 120\n40 140\n50 150\n5 20", "200"],
        ["3 5\n3 3\n4 4\n5 5", "5"],
        ["3 6\n3 3\n3 3\n3 3", "6"],
        ["4 5\n1 10\n1 10\n1 10\n1 10", "40"],
        ["3 9\n1 5\n4 8\n3 6", "13"],
        ["5 8\n2 1\n3 2\n4 3\n5 4\n1 5", "10"],
        ["2 1\n1 1000\n1 1000", "1000"],
        ["4 20\n5 100\n10 200\n15 300\n20 350", "500"],
        ["3 100\n50 50\n60 60\n70 70", "110"],
      ]
    ),
  },

  // ── 13. DYNAMIC PROGRAMMING ───────────────────────────────────────────────
  {
    title: "Coin Change (DP)",
    statement: `Given an array of $N$ coin denominations and a target amount $S$, find the **minimum number of coins** needed to make exactly $S$. Each coin can be used any number of times. If impossible, print $-1$.

**Input Format**
First line: $N\\ S$ ($1 \\le N \\le 12$, $0 \\le S \\le 10^4$).
Second line: $N$ distinct positive integers (denominations).

**Output Format**
Minimum coins or $-1$.

**Sample Input 1**
\`\`\`
3 11
1 5 6
\`\`\`
**Sample Output 1**
\`\`\`
2
\`\`\``,
    time_limit_ms: 2000,
    memory_limit_kb: 65536,
    test_cases: cases(
      [
        ["3 11\n1 5 6", "2"],
        ["2 3\n2 5", "-1"],
      ],
      [
        ["1 0\n1", "0"],
        ["1 10\n2", "5"],
        ["3 0\n1 2 3", "0"],
        ["3 100\n1 5 10", "10"],
        ["2 7\n3 5", "-1"],
        ["4 12\n1 5 6 9", "2"],
        ["3 11\n2 5 6", "-1"],
        ["5 30\n1 5 10 25 50", "2"],
        ["3 15\n1 3 5", "3"],
        ["2 6\n4 7", "-1"],
        ["3 100\n10 50 100", "1"],
        ["4 27\n1 3 9 27", "1"],
        ["3 10000\n1 7 11", "910"],
        ["2 13\n4 7", "2"],
        ["3 8\n3 5 7", "2"],
        ["2 6\n3 4", "2"],
        ["1 10000\n1", "10000"],
        ["3 5\n2 4 6", "-1"],
      ]
    ),
  },

  // ── 14. DYNAMIC PROGRAMMING ───────────────────────────────────────────────
  {
    title: "Longest Common Subsequence",
    statement: `Given two strings $A$ (length $M$) and $B$ (length $N$), find the **length of their longest common subsequence**.

**Input Format**
Two lines, each containing one string of lowercase letters ($1 \\le |A|, |B| \\le 1000$).

**Output Format**
A single integer.

**Sample Input 1**
\`\`\`
abcde
ace
\`\`\`
**Sample Output 1**
\`\`\`
3
\`\`\``,
    time_limit_ms: 3000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["abcde\nace", "3"],
        ["abc\nabc", "3"],
      ],
      [
        ["abc\ndef", "0"],
        ["a\na", "1"],
        ["a\nb", "0"],
        ["abcdef\nfedcba", "2"],
        ["abcbdab\nbdcaba", "4"],
        ["xmjyauz\nmzjawxu", "4"],
        ["aggtab\ngxtxayb", "4"],
        ["aabb\nbbaa", "2"],
        ["aaaa\naaaa", "4"],
        ["abc\nbac", "2"],
        ["abcde\nbade", "3"],
        ["oxcpqrsvwf\nspqrvcw", "5"],
        ["ABCBDAB\nBDCAB", "4"],
        ["banana\natana", "4"],
        ["random\nnandom", "5"],
        ["zxcv\nvcxz", "2"],
        ["hello\nhello", "5"],
        ["programming\nproving", "5"],
      ]
    ),
  },

  // ── 15. DFS / BFS ──────────────────────────────────────────────────────────
  {
    title: "Number of Islands",
    statement: `Given an $R \\times C$ grid of \`'1'\` (land) and \`'0'\` (water), count the **number of islands**. An island is a maximal group of \`'1'\`s connected horizontally or vertically.

**Input Format**
First line: $R\\ C$ ($1 \\le R, C \\le 300$).
Next $R$ lines: $C$ characters each (\`0\` or \`1\`).

**Output Format**
A single integer.

**Sample Input 1**
\`\`\`
4 5
11110
11010
11000
00000
\`\`\`
**Sample Output 1**
\`\`\`
1
\`\`\``,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["4 5\n11110\n11010\n11000\n00000", "1"],
        ["4 5\n11000\n11000\n00100\n00011", "3"],
      ],
      [
        ["1 1\n1", "1"],
        ["1 1\n0", "0"],
        ["2 2\n11\n11", "1"],
        ["2 2\n10\n01", "2"],
        ["3 3\n000\n000\n000", "0"],
        ["3 3\n111\n010\n111", "1"],
        ["3 3\n101\n010\n101", "5"],
        ["1 5\n10101", "3"],
        ["5 1\n1\n0\n1\n0\n1", "3"],
        ["3 4\n1001\n0110\n1001", "4"],
        ["4 4\n1111\n1001\n1001\n1111", "1"],
        ["3 5\n11011\n00000\n11011", "4"],
        ["2 3\n110\n110", "1"],
        ["4 4\n0000\n0110\n0110\n0000", "1"],
        ["5 5\n10101\n01010\n10101\n01010\n10101", "13"],
        ["3 3\n110\n001\n010", "3"],
        ["2 5\n11010\n11010", "2"],
        ["3 4\n1001\n1001\n0110", "3"],
      ]
    ),
  },

  // ── 16. DFS / BFS ──────────────────────────────────────────────────────────
  {
    title: "Shortest Path in Unweighted Graph",
    statement: `Given an undirected graph with $N$ nodes and $M$ edges, find the **shortest path (in edges)** from node $1$ to node $N$. If unreachable, print $-1$.

**Input Format**
First line: $N\\ M$ ($2 \\le N \\le 10^5$, $0 \\le M \\le 2 \\times 10^5$).
Next $M$ lines: $u\\ v$ ($1 \\le u, v \\le N$, $u \\ne v$).

**Output Format**
A single integer.

**Sample Input 1**
\`\`\`
5 5
1 2
1 3
2 4
3 4
4 5
\`\`\`
**Sample Output 1**
\`\`\`
3
\`\`\``,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["5 5\n1 2\n1 3\n2 4\n3 4\n4 5", "3"],
        ["3 1\n1 2", "-1"],
      ],
      [
        ["2 1\n1 2", "1"],
        ["4 4\n1 2\n2 3\n3 4\n1 4", "1"],
        ["6 7\n1 2\n1 3\n2 4\n3 4\n4 5\n4 6\n5 6", "3"],
        ["5 0", "-1"],
        ["4 3\n1 2\n2 3\n3 4", "3"],
        ["4 2\n1 2\n3 4", "-1"],
        ["6 8\n1 2\n2 3\n3 6\n1 4\n4 5\n5 6\n2 5\n3 5", "2"],
        ["7 6\n1 2\n2 3\n3 4\n4 5\n5 6\n6 7", "6"],
        ["5 6\n1 2\n2 3\n3 4\n4 5\n1 5\n2 4", "1"],
        ["3 3\n1 2\n2 3\n1 3", "1"],
        ["8 9\n1 2\n2 3\n3 4\n4 8\n1 5\n5 6\n6 7\n7 8\n2 6", "3"],
        ["4 4\n1 2\n1 3\n2 4\n3 4", "2"],
        ["5 4\n1 2\n2 3\n3 5\n4 5", "3"],
        ["6 5\n1 2\n2 3\n3 4\n4 5\n5 6", "5"],
        ["10 10\n1 2\n2 3\n3 4\n4 5\n5 6\n6 7\n7 8\n8 9\n9 10\n1 10", "1"],
        ["5 3\n1 2\n3 4\n4 5", "-1"],
        ["6 7\n1 3\n3 5\n5 6\n1 2\n2 4\n4 6\n3 4", "2"],
        ["4 5\n1 2\n1 3\n2 3\n2 4\n3 4", "2"],
      ]
    ),
  },

  // ── 17. DFS / BFS ──────────────────────────────────────────────────────────
  {
    title: "Rotting Oranges",
    statement: `An $R \\times C$ grid contains: $0$ (empty), $1$ (fresh orange), $2$ (rotten orange). Every minute, each rotten orange rots all fresh oranges **4-directionally** adjacent to it. Return the minimum minutes until no fresh oranges remain, or $-1$ if impossible.

**Input Format**
First line: $R\\ C$ ($1 \\le R, C \\le 10$).
Next $R$ lines: $C$ space-separated integers.

**Output Format**
A single integer.

**Sample Input 1**
\`\`\`
3 3
2 1 1
1 1 0
0 1 1
\`\`\`
**Sample Output 1**
\`\`\`
4
\`\`\``,
    time_limit_ms: 1000,
    memory_limit_kb: 65536,
    test_cases: cases(
      [
        ["3 3\n2 1 1\n1 1 0\n0 1 1", "4"],
        ["3 3\n2 1 1\n0 1 1\n1 0 1", "-1"],
      ],
      [
        ["1 1\n0", "0"],
        ["1 1\n1", "-1"],
        ["1 1\n2", "0"],
        ["3 3\n0 0 0\n0 0 0\n0 0 0", "0"],
        ["3 3\n2 2 2\n2 2 2\n2 2 2", "0"],
        ["2 2\n2 1\n1 1", "2"],
        ["3 3\n1 1 1\n1 2 1\n1 1 1", "2"],
        ["3 3\n2 0 2\n0 1 0\n2 0 2", "-1"],
        ["2 3\n2 1 1\n1 1 2", "1"],
        ["4 4\n2 0 0 0\n0 0 0 0\n0 0 0 0\n0 0 0 1", "-1"],
        ["1 5\n2 1 1 1 1", "4"],
        ["5 1\n2\n1\n1\n1\n1", "4"],
        ["3 3\n2 1 2\n1 1 1\n2 1 2", "1"],
        ["2 2\n1 0\n0 2", "-1"],
        ["4 4\n2 1 0 1\n1 1 0 1\n0 1 1 1\n0 0 1 2", "4"],
        ["1 3\n2 1 1", "2"],
        ["3 4\n2 1 1 1\n1 0 0 1\n1 1 1 2", "3"],
        ["2 2\n0 1\n0 2", "1"],
      ]
    ),
  },

  // ── 18. DFS / BFS ──────────────────────────────────────────────────────────
  {
    title: "Topological Sort (Course Schedule)",
    statement: `There are $N$ courses ($0$-indexed) and $M$ prerequisites. A prerequisite $(a, b)$ means you must take course $b$ before course $a$. Determine if it is possible to finish all courses (i.e., the graph has no cycle).

Print \`YES\` if possible, \`NO\` otherwise.

**Input Format**
First line: $N\\ M$ ($1 \\le N \\le 10^5$, $0 \\le M \\le 2 \\times 10^5$).
Next $M$ lines: $a\\ b$.

**Output Format**
\`YES\` or \`NO\`.

**Sample Input 1**
\`\`\`
2 1
1 0
\`\`\`
**Sample Output 1**
\`\`\`
YES
\`\`\``,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["2 1\n1 0", "YES"],
        ["2 2\n1 0\n0 1", "NO"],
      ],
      [
        ["1 0", "YES"],
        ["3 3\n1 0\n2 0\n2 1", "YES"],
        ["3 3\n0 1\n1 2\n2 0", "NO"],
        ["4 4\n1 0\n2 0\n3 1\n3 2", "YES"],
        ["4 4\n0 1\n1 2\n2 3\n3 0", "NO"],
        ["5 4\n0 1\n0 2\n3 1\n3 2", "YES"],
        ["4 3\n1 0\n2 1\n3 2", "YES"],
        ["3 2\n1 0\n1 2", "YES"],
        ["5 5\n0 1\n1 2\n2 3\n3 4\n4 0", "NO"],
        ["6 6\n1 0\n2 1\n3 0\n4 3\n5 4\n2 5", "YES"],
        ["6 7\n1 0\n2 1\n3 2\n4 3\n5 4\n0 5\n3 1", "NO"],
        ["4 0", "YES"],
        ["5 6\n0 1\n1 2\n2 3\n3 4\n4 2\n0 3", "NO"],
        ["4 4\n1 0\n2 1\n3 2\n1 3", "NO"],
        ["7 7\n1 0\n2 0\n3 1\n4 2\n5 3\n6 4\n6 5", "YES"],
        ["5 3\n4 3\n3 2\n2 1", "YES"],
        ["3 3\n0 1\n1 2\n0 2", "YES"],
        ["6 5\n1 0\n2 1\n3 2\n4 3\n5 4", "YES"],
      ]
    ),
  },

  // ── 19. TREES ─────────────────────────────────────────────────────────────
  {
    title: "Binary Tree Maximum Path Sum",
    statement: `Given a binary tree with $N$ nodes (values can be negative), find the **maximum path sum**. A path is a sequence of nodes where each pair of adjacent nodes has an edge; the path does not need to pass through the root.

**Input Format**
First line: $N$ ($1 \\le N \\le 3 \\times 10^4$).
Second line: $N$ integers — level-order values (\`-1\` means null).

**Output Format**
A single integer — maximum path sum.

**Sample Input 1**
\`\`\`
3
1 2 3
\`\`\`
**Sample Output 1**
\`\`\`
6
\`\`\``,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["3\n1 2 3", "6"],
        ["5\n-10 9 20 -1 -1 15 7", "42"],
      ],
      [
        ["1\n-3", "-3"],
        ["1\n5", "5"],
        ["3\n-2 -1 -1", "-1"],
        ["5\n1 -2 3 -1 -1 -1 -1", "4"],
        ["7\n5 4 8 11 -1 13 4 7 2 -1 -1 -1 1", "55"],
        ["3\n2 -1 3", "5"],
        ["5\n1 2 -1 3 4", "10"],
        ["7\n1 2 3 4 5 6 7", "22"],
        ["3\n-1 -2 -3", "-1"],
        ["3\n10 -5 20", "30"],
        ["5\n5 -2 4 3 -1", "12"],
        ["5\n3 1 2 -1 -1 -1 -1", "6"],
        ["7\n2 3 1 -1 4 -1 5", "12"],
        ["3\n1 1 1", "3"],
        ["5\n10 5 -3 3 2", "18"],
        ["3\n100 200 -150", "300"],
        ["5\n1 -5 10 -1 -1 -3 -1", "11"],
        ["7\n4 -2 3 1 -1 -1 2", "9"],
      ]
    ),
  },

  // ── 20. TREES ─────────────────────────────────────────────────────────────
  {
    title: "Diameter of Binary Tree",
    statement: `Given a binary tree with $N$ nodes, return its **diameter** — the length of the **longest path between any two nodes** (measured in number of edges; the path may or may not pass through the root).

**Input Format**
First line: $N$ ($1 \\le N \\le 10^4$).
Second line: level-order values (\`-1\` = null).

**Output Format**
A single integer.

**Sample Input 1**
\`\`\`
5
1 2 3 4 5
\`\`\`
**Sample Output 1**
\`\`\`
3
\`\`\``,
    time_limit_ms: 1000,
    memory_limit_kb: 65536,
    test_cases: cases(
      [
        ["5\n1 2 3 4 5", "3"],
        ["1\n1", "0"],
      ],
      [
        ["3\n1 2 3", "2"],
        ["5\n1 2 -1 3 -1 4 -1", "3"],
        ["7\n1 2 3 4 5 6 7", "4"],
        ["3\n1 -1 2", "1"],
        ["5\n1 2 -1 3 -1 4 -1", "3"],
        ["5\n1 2 3 -1 -1 4 5", "4"],
        ["3\n1 2 -1", "1"],
        ["4\n1 2 3 4 -1 -1 -1", "3"],
        ["5\n1 -1 2 -1 -1 -1 3", "2"],
        ["7\n1 2 3 4 -1 -1 5 6 -1 -1 -1 -1 -1 -1 7", "6"],
        ["3\n10 20 30", "2"],
        ["5\n1 2 3 4 -1 5 -1", "4"],
        ["4\n1 2 -1 -1 3 4 -1", "3"],
        ["6\n1 2 3 4 5 -1 -1", "3"],
        ["5\n1 -1 2 -1 -1 -1 3", "2"],
        ["7\n1 2 3 4 5 6 7", "4"],
        ["4\n1 2 3 4 -1 -1 -1", "3"],
        ["3\n1 2 3", "2"],
      ]
    ),
  },

  // ── 21. PREFIX SUM ─────────────────────────────────────────────────────────
  {
    title: "Range Sum Query",
    statement: `Given an array of $N$ integers and $Q$ queries, each query asks for the **sum of elements from index $l$ to $r$** (1-indexed, inclusive). Answer all queries.

**Input Format**
First line: $N\\ Q$ ($1 \\le N, Q \\le 10^5$).
Second line: $N$ integers ($-10^9 \\le a_i \\le 10^9$).
Next $Q$ lines: $l\\ r$ ($1 \\le l \\le r \\le N$).

**Output Format**
$Q$ lines, each the sum for that query.

**Sample Input 1**
\`\`\`
5 3
1 2 3 4 5
1 3
2 4
1 5
\`\`\`
**Sample Output 1**
\`\`\`
6
9
15
\`\`\``,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["5 3\n1 2 3 4 5\n1 3\n2 4\n1 5", "6\n9\n15"],
        ["3 2\n-1 2 -3\n1 2\n2 3", "1\n-1"],
      ],
      [
        ["1 1\n5\n1 1", "5"],
        ["4 4\n1 2 3 4\n1 1\n2 2\n3 3\n4 4", "1\n2\n3\n4"],
        ["5 1\n10 20 30 40 50\n2 4", "90"],
        ["6 3\n1 -1 1 -1 1 -1\n1 6\n2 5\n3 4", "0\n0\n0"],
        ["4 4\n100 200 300 400\n1 4\n1 2\n3 4\n2 3", "1000\n300\n700\n500"],
        ["5 5\n1 2 3 4 5\n1 1\n5 5\n2 4\n1 5\n3 3", "1\n5\n9\n15\n3"],
        ["3 3\n-5 5 -5\n1 3\n1 2\n2 3", "-5\n0\n0"],
        ["6 2\n2 4 6 8 10 12\n1 3\n4 6", "12\n30"],
        ["5 3\n5 5 5 5 5\n1 5\n2 4\n3 3", "25\n15\n5"],
        ["4 2\n-10 -20 -30 -40\n1 4\n2 3", "-100\n-50"],
        ["7 4\n1 0 2 0 3 0 4\n1 7\n2 6\n3 5\n4 4", "10\n5\n5\n0"],
        ["5 2\n1000000000 1000000000 1000000000 1000000000 1000000000\n1 5\n2 4", "5000000000\n3000000000"],
        ["4 3\n0 0 0 0\n1 4\n1 1\n4 4", "0\n0\n0"],
        ["6 3\n3 1 4 1 5 9\n1 6\n2 5\n3 4", "23\n11\n5"],
        ["5 5\n-3 -2 -1 0 1\n1 5\n1 4\n1 3\n1 2\n1 1", "-5\n-6\n-6\n-5\n-3"],
        ["3 1\n7 8 9\n1 3", "24"],
        ["5 4\n2 2 2 2 2\n1 5\n2 3\n3 5\n1 1", "10\n4\n6\n2"],
        ["4 2\n1000 -500 250 -125\n1 4\n2 3", "625\n-250"],
      ]
    ),
  },

  // ── 22. PREFIX SUM / HASHING ──────────────────────────────────────────────
  {
    title: "Subarray Sum Equals K",
    statement: `Given an array of $N$ integers and an integer $K$, count the **number of contiguous subarrays** whose sum equals $K$.

**Input Format**
First line: $N\\ K$ ($1 \\le N \\le 2 \\times 10^4$, $-10^9 \\le K \\le 10^9$).
Second line: $N$ integers ($-10^4 \\le a_i \\le 10^4$).

**Output Format**
A single integer.

**Sample Input 1**
\`\`\`
5 2
1 1 1 2 -1
\`\`\`
**Sample Output 1**
\`\`\`
4
\`\`\``,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["5 2\n1 1 1 2 -1", "4"],
        ["4 3\n1 2 3 0", "3"],
      ],
      [
        ["1 0\n0", "1"],
        ["3 3\n3 0 0", "3"],
        ["4 0\n0 0 0 0", "10"],
        ["5 5\n1 2 3 4 5", "2"],
        ["5 15\n1 2 3 4 5", "1"],
        ["5 -1\n1 -1 1 -1 1", "3"],
        ["4 2\n1 1 1 1", "3"],
        ["6 3\n1 1 1 1 1 1", "4"],
        ["3 0\n1 -1 0", "3"],
        ["5 1\n-1 -1 1 1 0", "3"],
        ["4 10\n1 2 3 4", "2"],
        ["5 0\n1 -1 1 -1 0", "5"],
        ["6 5\n2 3 1 2 4 3", "3"],
        ["4 -3\n-1 -2 -3 -4", "2"],
        ["5 100\n1 2 3 4 5", "0"],
        ["7 3\n1 2 0 3 0 0 3", "7"],
        ["5 2\n2 -2 2 -2 2", "5"],
        ["4 4\n1 3 3 1", "2"],
      ]
    ),
  },

  // ── 23. GRAPHS / UNION-FIND ───────────────────────────────────────────────
  {
    title: "Number of Connected Components",
    statement: `Given an undirected graph with $N$ nodes (1-indexed) and $M$ edges, find the **number of connected components**.

**Input Format**
First line: $N\\ M$ ($1 \\le N \\le 10^5$, $0 \\le M \\le 2 \\times 10^5$).
Next $M$ lines: $u\\ v$ ($1 \\le u, v \\le N$, $u \\ne v$).

**Output Format**
A single integer.

**Sample Input 1**
\`\`\`
5 4
1 2
1 3
4 5
1 4
\`\`\`
**Sample Output 1**
\`\`\`
1
\`\`\``,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["5 4\n1 2\n1 3\n4 5\n1 4", "1"],
        ["5 3\n1 2\n3 4\n5 1", "2"],
      ],
      [
        ["1 0", "1"],
        ["5 0", "5"],
        ["4 4\n1 2\n2 3\n3 4\n4 1", "1"],
        ["6 4\n1 2\n3 4\n5 6\n1 3", "2"],
        ["4 2\n1 2\n3 4", "2"],
        ["6 3\n1 2\n3 4\n5 6", "3"],
        ["7 6\n1 2\n2 3\n3 4\n5 6\n6 7\n7 5", "2"],
        ["10 5\n1 2\n3 4\n5 6\n7 8\n9 10", "5"],
        ["5 5\n1 2\n2 3\n3 4\n4 5\n5 1", "1"],
        ["6 5\n1 2\n2 3\n4 5\n5 6\n3 4", "1"],
        ["8 4\n1 2\n3 4\n5 6\n7 8", "4"],
        ["4 3\n1 2\n2 3\n3 4", "1"],
        ["5 2\n1 3\n2 4", "3"],
        ["3 0", "3"],
        ["6 0", "6"],
        ["7 7\n1 2\n2 3\n3 1\n4 5\n5 6\n6 7\n7 4", "2"],
        ["5 4\n1 2\n2 5\n3 4\n4 5", "1"],
        ["4 1\n2 3", "3"],
      ]
    ),
  },

  // ── 24. GRAPHS / SHORTEST PATH ────────────────────────────────────────────
  {
    title: "Dijkstra – Single Source Shortest Path",
    statement: `Given a weighted directed graph with $N$ nodes and $M$ edges, find the **shortest distance from node $1$ to all other nodes**. Edge weights are non-negative. Print the distances on a single line; unreachable nodes print $-1$.

**Input Format**
First line: $N\\ M$ ($1 \\le N \\le 10^4$, $0 \\le M \\le 3 \\times 10^4$).
Next $M$ lines: $u\\ v\\ w$ ($1 \\le u, v \\le N$, $u \\ne v$, $0 \\le w \\le 10^4$).

**Output Format**
$N$ space-separated integers $d_1\\ d_2\\ \\ldots\\ d_N$ (distances from node 1; $d_1 = 0$).

**Sample Input 1**
\`\`\`
4 4
1 2 1
2 3 2
1 3 4
3 4 1
\`\`\`
**Sample Output 1**
\`\`\`
0 1 3 4
\`\`\``,
    time_limit_ms: 3000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["4 4\n1 2 1\n2 3 2\n1 3 4\n3 4 1", "0 1 3 4"],
        ["3 2\n1 2 5\n1 3 10", "0 5 10"],
      ],
      [
        ["2 0", "0 -1"],
        ["3 3\n1 2 3\n2 3 1\n1 3 5", "0 3 4"],
        ["4 6\n1 2 7\n1 3 9\n1 4 14\n2 3 10\n3 4 2\n2 4 15", "0 7 9 11"],
        ["5 8\n1 2 4\n1 3 2\n2 3 1\n2 4 5\n3 5 3\n4 5 1\n3 4 8\n1 5 16", "0 4 2 9 5"],
        ["3 0", "0 -1 -1"],
        ["4 3\n1 2 1\n2 3 1\n3 4 1", "0 1 2 3"],
        ["5 5\n1 2 1\n2 3 1\n3 4 1\n4 5 1\n1 5 10", "0 1 2 3 4"],
        ["4 4\n1 2 0\n2 3 0\n3 4 0\n1 4 100", "0 0 0 0"],
        ["3 4\n1 2 10\n1 2 5\n2 3 3\n1 3 20", "0 5 8"],
        ["4 3\n1 2 10000\n2 3 10000\n3 4 10000", "0 10000 20000 30000"],
        ["5 5\n1 2 1\n1 3 5\n2 4 2\n3 4 1\n4 5 1", "0 1 5 3 4"],
        ["3 2\n1 2 1\n1 3 2", "0 1 2"],
        ["4 4\n1 2 2\n2 4 3\n1 3 4\n3 4 1", "0 2 4 5"],
        ["5 4\n1 2 100\n2 3 100\n3 4 100\n4 5 100", "0 100 200 300 400"],
        ["4 5\n1 2 3\n1 3 7\n2 3 2\n2 4 5\n3 4 1", "0 3 5 6"],
        ["6 7\n1 2 1\n1 3 2\n2 4 3\n3 4 1\n4 5 2\n4 6 4\n5 6 1", "0 1 2 3 5 6"],
        ["3 3\n1 2 1\n2 3 1\n1 3 3", "0 1 2"],
        ["4 4\n1 4 1\n1 2 10\n2 3 10\n3 4 10", "0 10 20 1"],
      ]
    ),
  },

  // ── 25. GRAPHS / BACKTRACKING ─────────────────────────────────────────────
  {
    title: "N-Queens",
    statement: `Place $N$ non-attacking queens on an $N \\times N$ chessboard. Count all **distinct valid placements**.

**Input Format**
A single integer $N$ ($1 \\le N \\le 13$).

**Output Format**
A single integer — number of solutions.

**Sample Input 1**
\`\`\`
4
\`\`\`
**Sample Output 1**
\`\`\`
2
\`\`\``,
    time_limit_ms: 3000,
    memory_limit_kb: 65536,
    test_cases: cases(
      [["4", "2"], ["8", "92"]],
      [
        ["1", "1"], ["2", "0"], ["3", "0"], ["5", "10"],
        ["6", "4"], ["7", "40"], ["9", "352"], ["10", "724"],
        ["11", "2680"], ["12", "14200"], ["13", "73712"],
        ["1", "1"], ["3", "0"], ["6", "4"], ["7", "40"],
        ["9", "352"], ["11", "2680"], ["5", "10"],
        ["13", "73712"],
      ]
    ),
  },

  // ── 26. STACK ─────────────────────────────────────────────────────────────
  {
    title: "Largest Rectangle in Histogram",
    statement: `Given a histogram with $N$ bars of heights $h_1, h_2, \\ldots, h_N$ (each bar width = 1), find the **area of the largest rectangle** that can be formed inside the histogram.

**Input Format**
First line: $N$ ($1 \\le N \\le 10^5$).
Second line: $N$ non-negative integers $h_i$ ($0 \\le h_i \\le 10^4$).

**Output Format**
A single integer.

**Sample Input 1**
\`\`\`
6
2 1 5 6 2 3
\`\`\`
**Sample Output 1**
\`\`\`
10
\`\`\``,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["6\n2 1 5 6 2 3", "10"],
        ["5\n2 4 2 1 10", "10"],
      ],
      [
        ["1\n0", "0"],
        ["1\n5", "5"],
        ["5\n1 1 1 1 1", "5"],
        ["5\n5 4 3 2 1", "9"],
        ["5\n1 2 3 4 5", "9"],
        ["3\n3 3 3", "9"],
        ["4\n2 0 2 2", "4"],
        ["7\n6 2 5 4 5 1 6", "12"],
        ["6\n3 6 5 7 4 8", "20"],
        ["4\n0 0 0 0", "0"],
        ["3\n10000 10000 10000", "30000"],
        ["5\n2 1 2 3 1", "5"],
        ["8\n1 0 1 0 1 0 1 0", "1"],
        ["6\n4 2 0 3 2 5", "6"],
        ["4\n2 3 2 3", "8"],
        ["7\n1 2 3 4 5 4 3", "18"],
        ["5\n0 4 4 0 4", "8"],
        ["6\n2 2 2 2 2 2", "12"],
      ]
    ),
  },

  // ── 27. STACK / MONOTONIC ─────────────────────────────────────────────────
  {
    title: "Next Greater Element",
    statement: `Given an array of $N$ distinct integers, for each element find the **first greater element to its right**. If none exists, print $-1$.

**Input Format**
First line: $N$ ($1 \\le N \\le 10^5$).
Second line: $N$ integers.

**Output Format**
$N$ space-separated integers.

**Sample Input 1**
\`\`\`
6
4 5 2 25 7 8
\`\`\`
**Sample Output 1**
\`\`\`
5 25 25 -1 8 -1
\`\`\``,
    time_limit_ms: 1000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["6\n4 5 2 25 7 8", "5 25 25 -1 8 -1"],
        ["4\n13 7 6 12", "-1 12 12 -1"],
      ],
      [
        ["1\n5", "-1"],
        ["3\n1 2 3", "2 3 -1"],
        ["3\n3 2 1", "-1 -1 -1"],
        ["5\n1 3 2 4 5", "3 4 4 5 -1"],
        ["4\n4 3 2 1", "-1 -1 -1 -1"],
        ["5\n1 2 3 4 5", "2 3 4 5 -1"],
        ["4\n2 1 3 4", "3 3 4 -1"],
        ["6\n6 5 4 3 2 1", "-1 -1 -1 -1 -1 -1"],
        ["5\n3 8 4 10 6", "8 10 10 -1 -1"],
        ["6\n1 6 2 7 3 8", "6 7 7 8 8 -1"],
        ["4\n5 1 2 3", "-1 2 3 -1"],
        ["5\n10 4 6 3 5", "-1 6 -1 5 -1"],
        ["7\n1 2 1 2 1 2 1", "2 -1 2 -1 2 -1 -1"],
        ["5\n9 8 7 6 5", "-1 -1 -1 -1 -1"],
        ["6\n2 1 4 3 6 5", "4 4 6 6 -1 -1"],
        ["4\n100 1 2 3", "-1 2 3 -1"],
        ["5\n3 1 4 1 5", "4 4 5 5 -1"],
        ["6\n1 3 5 7 9 11", "3 5 7 9 11 -1"],
      ]
    ),
  },

  // ── 28. STRING / HASHING ─────────────────────────────────────────────────
  {
    title: "Anagram Groups",
    statement: `Given $N$ words, group them by anagram class and output the **number of groups** followed by the **size of the largest group**.

**Input Format**
First line: $N$ ($1 \\le N \\le 10^4$).
Next $N$ lines: one word per line (lowercase letters, length $\\le 20$).

**Output Format**
Two space-separated integers: number of groups, size of largest group.

**Sample Input 1**
\`\`\`
6
eat
tea
tan
ate
nat
bat
\`\`\`
**Sample Output 1**
\`\`\`
3 3
\`\`\``,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["6\neat\ntea\ntan\nate\nnat\nbat", "3 3"],
        ["1\na", "1 1"],
      ],
      [
        ["2\nab\nba", "1 2"],
        ["3\nabc\nbca\ncba", "1 3"],
        ["4\ndog\ngod\ncat\ntac", "2 2"],
        ["5\na\nb\nc\nd\ne", "5 1"],
        ["4\nab\nab\nba\nba", "1 4"],
        ["6\none\nnoe\ntwo\nown\neon\nawt", "3 3"],
        ["3\nlisten\nsilent\nenlist", "1 3"],
        ["8\nrace\ncare\nacre\ncear\nhello\nworld\nolelh\nrodwl", "4 4"],
        ["5\nabc\ndef\nghi\njkl\nmno", "5 1"],
        ["4\nab\ncd\nba\ndc", "2 2"],
        ["3\naaa\naaa\naaa", "1 3"],
        ["5\nstop\npots\nspot\ntops\nopts", "1 5"],
        ["4\nab\nbc\ncd\nde", "4 1"],
        ["6\ndast\ndats\nstad\nstea\naset\ntaes", "3 3"],
        ["4\npear\nrape\nreap\naper", "1 4"],
        ["3\nxy\nyz\nzx", "3 1"],
        ["5\nabcde\nbcdea\ncdea\ndeabc\neabcd", "2 4"],
        ["4\nkite\ntike\nteki\netki", "1 4"],
      ]
    ),
  },

  // ── 29. MATH ──────────────────────────────────────────────────────────────
  {
    title: "Power Modulo",
    statement: `Compute $a^b \\mod m$ efficiently.

**Input Format**
A single line with three integers: $a\\ b\\ m$ ($0 \\le a, b \\le 10^{18}$, $1 \\le m \\le 10^9$).

**Output Format**
A single integer in $[0, m)$.

**Sample Input 1**
\`\`\`
2 10 1000
\`\`\`
**Sample Output 1**
\`\`\`
24
\`\`\``,
    time_limit_ms: 1000,
    memory_limit_kb: 32768,
    test_cases: cases(
      [
        ["2 10 1000", "24"],
        ["3 3 7", "6"],
      ],
      [
        ["0 0 1", "0"],
        ["1 1000000000000000000 7", "1"],
        ["2 0 1000000000", "1"],
        ["10 9 1000000007", "1000000000"],
        ["0 5 3", "0"],
        ["7 13 1000000007", "96889010407"],
        ["2 63 1000000007", "807896673"],
        ["5 100 1000000007", "535983875"],
        ["3 1000000000 1000000007", "69473947"],
        ["999999999 999999999 1000000007", "888750149"],
        ["2 1 1", "0"],
        ["4 5 3", "1"],
        ["100 100 1000", "0"],
        ["6 7 13", "7"],
        ["7 0 100", "1"],
        ["2 31 1000000000", "147483648"],
        ["17 17 1000000007", "827240261"],
        ["123456789 987654321 1000000007", "652541198"],
      ]
    ),
  },

  // ── 30. MATH / COMBINATORICS ──────────────────────────────────────────────
  {
    title: "Count Paths in Grid",
    statement: `Given an $M \\times N$ grid, count the number of **unique paths** from the top-left corner to the bottom-right corner. You can only move **right** or **down**.

The answer can be very large; output it **modulo $10^9 + 7$**.

$$\\text{paths}(M, N) = \\binom{M+N-2}{M-1} \\mod (10^9+7)$$

**Input Format**
A single line with two integers $M\\ N$ ($1 \\le M, N \\le 10^6$).

**Output Format**
A single integer.

**Sample Input 1**
\`\`\`
3 7
\`\`\`
**Sample Output 1**
\`\`\`
28
\`\`\``,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["3 7", "28"],
        ["3 3", "6"],
      ],
      [
        ["1 1", "1"],
        ["1 10", "1"],
        ["10 1", "1"],
        ["2 2", "2"],
        ["5 5", "70"],
        ["10 10", "48620"],
        ["20 20", "137846528640"],
        ["100 100", "407336795"],
        ["1000 1000", "501620422"],
        ["1 1000000", "1"],
        ["1000000 1", "1"],
        ["2 1000000", "999999"],
        ["500000 500000", "302839847"],
        ["4 4", "20"],
        ["6 6", "252"],
        ["15 15", "40116600"],
        ["50 50", "605405732"],
        ["200 300", "728895377"],
      ]
    ),
  },
];

// ---------------------------------------------------------------------------
// Insert into DB
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Seeding ${QUESTIONS.length} questions...`);

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];

    const [{ id }] = await sql<[{ id: string }]>`
      INSERT INTO questions (title, statement, time_limit_ms, memory_limit_kb)
      VALUES (${q.title}, ${q.statement}, ${q.time_limit_ms}, ${q.memory_limit_kb})
      RETURNING id
    `;

    for (let ord = 0; ord < q.test_cases.length; ord++) {
      const tc = q.test_cases[ord];
      await sql`
        INSERT INTO test_cases (question_id, ord, input, expected_output, is_sample)
        VALUES (${id}, ${ord + 1}, ${tc.input}, ${tc.output}, ${tc.is_sample})
      `;
    }

    console.log(`  [${i + 1}/30] ${q.title} — ${q.test_cases.length} test cases`);
  }

  console.log("Done.");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
