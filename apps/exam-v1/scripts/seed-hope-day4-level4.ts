/**
 * HOPE Day 4 — Level 4: Grid DP
 * Oct 10, 2026 | 7:50 AM – 9:20 AM IST | 60 minutes
 * 5 questions × 20 test cases (2 sample + 18 hidden)
 * Languages: c, cpp, python, java
 * Batches: 3Y-HOPE-B2, 3Y-HOPE-B3, SEB-TEST
 */

import { sql } from "../lib/db.ts";

const ADMIN_ID = "2cabecf4-74f4-461c-b596-d0fee3fb88b5";

const BATCHES = [
  "3Y-HOPE-B2",
  "3Y-HOPE-B3",
  "SEB-TEST",
];

interface TestCase {
  input: string;
  output: string;
  is_sample: boolean;
}

interface Question {
  title: string;
  topic: string;
  difficulty: string;
  statement: string;
  time_limit_ms: number;
  memory_limit_kb: number;
  test_cases: TestCase[];
}

function cases(samples: [string, string][], hidden: [string, string][]): TestCase[] {
  return [
    ...samples.map(([input, output]) => ({ input, output, is_sample: true })),
    ...hidden.map(([input, output]) => ({ input, output, is_sample: false })),
  ];
}

// ── DP solvers for test case generation ──

function solveMinPathSum(lines: string): string {
  const rows = lines.trim().split("\n");
  const [R, C] = rows[0].split(" ").map(Number);
  const grid: number[][] = [];
  for (let i = 1; i <= R; i++) grid.push(rows[i].split(" ").map(Number));
  const dp = Array.from({ length: R }, () => Array(C).fill(0));
  dp[0][0] = grid[0][0];
  for (let j = 1; j < C; j++) dp[0][j] = dp[0][j - 1] + grid[0][j];
  for (let i = 1; i < R; i++) dp[i][0] = dp[i - 1][0] + grid[i][0];
  for (let i = 1; i < R; i++) for (let j = 1; j < C; j++) dp[i][j] = Math.min(dp[i - 1][j], dp[i][j - 1]) + grid[i][j];
  return String(dp[R - 1][C - 1]);
}

function solveUniquePaths(lines: string): string {
  const rows = lines.trim().split("\n");
  const [R, C] = rows[0].split(" ").map(Number);
  const grid: number[][] = [];
  for (let i = 1; i <= R; i++) grid.push(rows[i].split(" ").map(Number));
  if (grid[0][0] === 1 || grid[R - 1][C - 1] === 1) return "0";
  const dp = Array.from({ length: R }, () => Array(C).fill(0n));
  dp[0][0] = 1n;
  for (let j = 1; j < C; j++) dp[0][j] = grid[0][j] === 1 ? 0n : dp[0][j - 1];
  for (let i = 1; i < R; i++) dp[i][0] = grid[i][0] === 1 ? 0n : dp[i - 1][0];
  for (let i = 1; i < R; i++) for (let j = 1; j < C; j++) dp[i][j] = grid[i][j] === 1 ? 0n : dp[i - 1][j] + dp[i][j - 1];
  return dp[R - 1][C - 1].toString();
}

function solveMaxSquare(lines: string): string {
  const rows = lines.trim().split("\n");
  const [R, C] = rows[0].split(" ").map(Number);
  const grid: number[][] = [];
  for (let i = 1; i <= R; i++) grid.push(rows[i].split(" ").map(Number));
  const dp = Array.from({ length: R }, () => Array(C).fill(0));
  let mx = 0;
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
    if (grid[i][j] === 1) {
      dp[i][j] = (i === 0 || j === 0) ? 1 : Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1;
      mx = Math.max(mx, dp[i][j]);
    }
  }
  return String(mx * mx);
}

function solveDungeon(lines: string): string {
  const rows = lines.trim().split("\n");
  const [R, C] = rows[0].split(" ").map(Number);
  const grid: number[][] = [];
  for (let i = 1; i <= R; i++) grid.push(rows[i].split(" ").map(Number));
  const dp = Array.from({ length: R }, () => Array(C).fill(0));
  dp[R - 1][C - 1] = Math.max(1 - grid[R - 1][C - 1], 1);
  for (let j = C - 2; j >= 0; j--) dp[R - 1][j] = Math.max(dp[R - 1][j + 1] - grid[R - 1][j], 1);
  for (let i = R - 2; i >= 0; i--) dp[i][C - 1] = Math.max(dp[i + 1][C - 1] - grid[i][C - 1], 1);
  for (let i = R - 2; i >= 0; i--) for (let j = C - 2; j >= 0; j--) dp[i][j] = Math.max(Math.min(dp[i + 1][j], dp[i][j + 1]) - grid[i][j], 1);
  return String(dp[0][0]);
}

function solveGold(lines: string): string {
  const rows = lines.trim().split("\n");
  const [R, C] = rows[0].split(" ").map(Number);
  const grid: number[][] = [];
  for (let i = 1; i <= R; i++) grid.push(rows[i].split(" ").map(Number));
  const dp = Array.from({ length: R }, (_, i) => grid[i].slice());
  for (let j = 1; j < C; j++) for (let i = 0; i < R; i++) {
    let best = dp[i][j - 1];
    if (i > 0) best = Math.max(best, dp[i - 1][j - 1]);
    if (i < R - 1) best = Math.max(best, dp[i + 1][j - 1]);
    dp[i][j] += best;
  }
  let ans = 0;
  for (let i = 0; i < R; i++) ans = Math.max(ans, dp[i][C - 1]);
  return String(ans);
}

// ── Random grid generator ──

let seed = 42;
function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; }
function randInt(lo: number, hi: number) { return lo + (rng() % (hi - lo + 1)); }

function gridInput(R: number, C: number, lo: number, hi: number): string {
  const rows: string[] = [`${R} ${C}`];
  for (let i = 0; i < R; i++) {
    const row: number[] = [];
    for (let j = 0; j < C; j++) row.push(randInt(lo, hi));
    rows.push(row.join(" "));
  }
  return rows.join("\n");
}

function binaryGridInput(R: number, C: number, density: number): string {
  const rows: string[] = [`${R} ${C}`];
  for (let i = 0; i < R; i++) {
    const row: number[] = [];
    for (let j = 0; j < C; j++) row.push(randInt(0, 100) < density ? 1 : 0);
    rows.push(row.join(" "));
  }
  return rows.join("\n");
}

function obstacleGridInput(R: number, C: number, prob: number): string {
  const rows: string[] = [`${R} ${C}`];
  const grid: number[][] = [];
  for (let i = 0; i < R; i++) {
    const row: number[] = [];
    for (let j = 0; j < C; j++) row.push(randInt(0, 100) < prob ? 1 : 0);
    grid.push(row);
  }
  grid[0][0] = 0;
  grid[R - 1][C - 1] = 0;
  for (let i = 0; i < R; i++) rows.push(grid[i].join(" "));
  return rows.join("\n");
}

function gen(solver: (s: string) => string, input: string): [string, string] {
  return [input, solver(input)];
}

// ── Questions ──

const QUESTIONS: Question[] = [
  // ── Q1: Minimum Path Sum ──
  {
    title: "Minimum Path Sum",
    topic: "Grid DP",
    difficulty: "easy",
    statement: `You are given a grid of $R$ rows and $C$ columns, filled with **non-negative integers**. Find a path from the **top-left** cell to the **bottom-right** cell that **minimizes the sum** of all numbers along the path.

You can only move **right** or **down** at each step.

---

**Input Format**

- First line: two integers $R$ and $C$ — the number of rows and columns $(1 \\le R, C \\le 200)$
- Next $R$ lines: $C$ space-separated non-negative integers $(0 \\le \\text{val} \\le 1000)$

**Output Format**

Print a single integer — the minimum path sum.

---

**Sample Input 1**
\`\`\`
3 3
1 3 1
1 5 1
4 2 1
\`\`\`
**Sample Output 1**
\`\`\`
7
\`\`\`
**Explanation:** Path 1→3→1→1→1 = 7.

---

**Sample Input 2**
\`\`\`
2 2
1 2
3 4
\`\`\`
**Sample Output 2**
\`\`\`
7
\`\`\`

---

**Constraints**
- $1 \\le R, C \\le 200$
- $0 \\le \\text{grid}[i][j] \\le 1000$

**Hint:** Use dynamic programming. $dp[i][j] = grid[i][j] + \\min(dp[i-1][j],\\, dp[i][j-1])$.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["3 3\n1 3 1\n1 5 1\n4 2 1", "7"],
        ["2 2\n1 2\n3 4", "7"],
      ],
      [
        gen(solveMinPathSum, "1 1\n5"),
        gen(solveMinPathSum, "1 5\n1 2 3 4 5"),
        gen(solveMinPathSum, "4 1\n2\n3\n1\n4"),
        gen(solveMinPathSum, "3 3\n0 0 0\n0 0 0\n0 0 0"),
        gen(solveMinPathSum, "3 3\n1 1 1\n1 1 1\n1 1 1"),
        gen(solveMinPathSum, "3 3\n1 100 100\n100 1 100\n100 100 1"),
        gen(solveMinPathSum, "2 2\n0 1\n1 0"),
        gen(solveMinPathSum, gridInput(10, 10, 0, 100)),
        gen(solveMinPathSum, gridInput(15, 20, 0, 500)),
        gen(solveMinPathSum, gridInput(20, 15, 1, 200)),
        gen(solveMinPathSum, gridInput(50, 50, 0, 1000)),
        gen(solveMinPathSum, gridInput(80, 60, 0, 1000)),
        gen(solveMinPathSum, gridInput(100, 100, 0, 1000)),
        gen(solveMinPathSum, gridInput(200, 200, 0, 1000)),
        gen(solveMinPathSum, gridInput(150, 200, 0, 1000)),
        gen(solveMinPathSum, gridInput(200, 150, 0, 500)),
        gen(solveMinPathSum, gridInput(200, 200, 0, 1000)),
        gen(solveMinPathSum, gridInput(200, 200, 0, 0)),
      ]
    ),
  },

  // ── Q2: Unique Paths with Obstacles ──
  {
    title: "Unique Paths with Obstacles",
    topic: "Grid DP",
    difficulty: "medium",
    statement: `You are given a grid of $R$ rows and $C$ columns. Each cell is either **free** (0) or **blocked** (1). Find the number of **unique paths** from the top-left to the bottom-right cell, moving only **right** or **down**.

---

**Input Format**

- First line: two integers $R$ and $C$ $(1 \\le R, C \\le 200)$
- Next $R$ lines: $C$ space-separated integers, each 0 or 1

**Output Format**

Print a single integer — the number of unique paths. The answer can be very large.

---

**Sample Input 1**
\`\`\`
3 3
0 0 0
0 1 0
0 0 0
\`\`\`
**Sample Output 1**
\`\`\`
2
\`\`\`

---

**Sample Input 2**
\`\`\`
2 2
0 1
0 0
\`\`\`
**Sample Output 2**
\`\`\`
1
\`\`\`

---

**Constraints**
- $1 \\le R, C \\le 200$
- $\\text{grid}[i][j] \\in \\{0, 1\\}$
- The answer may be extremely large — use appropriate data types.

**Hint:** $dp[i][j] = 0$ if blocked, else $dp[i-1][j] + dp[i][j-1]$.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["3 3\n0 0 0\n0 1 0\n0 0 0", "2"],
        ["2 2\n0 1\n0 0", "1"],
      ],
      [
        gen(solveUniquePaths, "1 1\n1"),
        gen(solveUniquePaths, "1 1\n0"),
        gen(solveUniquePaths, "2 2\n0 0\n0 1"),
        gen(solveUniquePaths, "3 3\n0 0 0\n0 0 0\n0 0 0"),
        gen(solveUniquePaths, "3 3\n0 0 0\n1 1 1\n0 0 0"),
        gen(solveUniquePaths, "1 5\n0 0 0 0 0"),
        gen(solveUniquePaths, "1 5\n0 0 1 0 0"),
        gen(solveUniquePaths, "5 1\n0\n0\n0\n0\n0"),
        gen(solveUniquePaths, obstacleGridInput(8, 8, 15)),
        gen(solveUniquePaths, obstacleGridInput(10, 10, 10)),
        gen(solveUniquePaths, obstacleGridInput(10, 12, 20)),
        gen(solveUniquePaths, obstacleGridInput(15, 15, 10)),
        gen(solveUniquePaths, obstacleGridInput(15, 15, 5)),
        gen(solveUniquePaths, obstacleGridInput(20, 20, 8)),
        gen(solveUniquePaths, obstacleGridInput(20, 20, 0)),
        gen(solveUniquePaths, "2 2\n1 0\n0 0"),
        gen(solveUniquePaths, obstacleGridInput(12, 12, 12)),
        gen(solveUniquePaths, obstacleGridInput(18, 18, 15)),
      ]
    ),
  },

  // ── Q3: Maximal Square ──
  {
    title: "Maximal Square",
    topic: "Grid DP",
    difficulty: "medium",
    statement: `You are given a binary matrix of $R$ rows and $C$ columns (each cell is 0 or 1). Find the **area** of the largest **square** sub-matrix that contains only 1s.

---

**Input Format**

- First line: two integers $R$ and $C$ $(1 \\le R, C \\le 200)$
- Next $R$ lines: $C$ space-separated integers (0 or 1)

**Output Format**

Print a single integer — the area (side²) of the largest all-ones square.

---

**Sample Input 1**
\`\`\`
4 5
1 0 1 0 0
1 0 1 1 1
1 1 1 1 1
1 0 0 1 0
\`\`\`
**Sample Output 1**
\`\`\`
4
\`\`\`
**Explanation:** The largest square is 2×2 (area = 4).

---

**Sample Input 2**
\`\`\`
2 2
0 1
1 0
\`\`\`
**Sample Output 2**
\`\`\`
1
\`\`\`

---

**Constraints**
- $1 \\le R, C \\le 200$
- $\\text{grid}[i][j] \\in \\{0, 1\\}$

**Hint:** $dp[i][j] = \\min(dp[i-1][j],\\, dp[i][j-1],\\, dp[i-1][j-1]) + 1$ when $grid[i][j] = 1$.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["4 5\n1 0 1 0 0\n1 0 1 1 1\n1 1 1 1 1\n1 0 0 1 0", "4"],
        ["2 2\n0 1\n1 0", "1"],
      ],
      [
        gen(solveMaxSquare, "3 3\n0 0 0\n0 0 0\n0 0 0"),
        gen(solveMaxSquare, "3 3\n1 1 1\n1 1 1\n1 1 1"),
        gen(solveMaxSquare, "1 1\n1"),
        gen(solveMaxSquare, "1 1\n0"),
        gen(solveMaxSquare, "1 5\n1 1 1 1 1"),
        gen(solveMaxSquare, "5 1\n1\n1\n1\n1\n1"),
        gen(solveMaxSquare, "4 4\n1 1 1 0\n1 1 1 0\n1 1 0 0\n0 0 0 0"),
        gen(solveMaxSquare, binaryGridInput(10, 10, 60)),
        gen(solveMaxSquare, binaryGridInput(15, 15, 70)),
        gen(solveMaxSquare, binaryGridInput(20, 20, 50)),
        gen(solveMaxSquare, binaryGridInput(30, 30, 65)),
        gen(solveMaxSquare, binaryGridInput(50, 50, 55)),
        gen(solveMaxSquare, binaryGridInput(80, 80, 60)),
        gen(solveMaxSquare, binaryGridInput(100, 100, 70)),
        gen(solveMaxSquare, binaryGridInput(150, 150, 50)),
        gen(solveMaxSquare, binaryGridInput(200, 200, 60)),
        gen(solveMaxSquare, binaryGridInput(200, 200, 55)),
        gen(solveMaxSquare, binaryGridInput(20, 20, 90)),
      ]
    ),
  },

  // ── Q4: Dungeon Game ──
  {
    title: "Dungeon Game",
    topic: "Grid DP",
    difficulty: "hard",
    statement: `A knight must travel from the **top-left** to the **bottom-right** of an $R \\times C$ grid. Each cell contains an integer — positive values restore health, negative values deal damage.

The knight starts with some **initial health** and loses/gains health as they enter each cell. If the knight's health drops to **0 or below at any point**, they die.

Find the **minimum initial health** needed so that the knight can reach the bottom-right cell alive (health ≥ 1 at every step, including the starting and ending cells).

---

**Input Format**

- First line: two integers $R$ and $C$ $(1 \\le R, C \\le 200)$
- Next $R$ lines: $C$ space-separated integers $(-1000 \\le \\text{val} \\le 1000)$

**Output Format**

Print a single integer — the minimum initial health.

---

**Sample Input 1**
\`\`\`
3 3
-2 -3 3
-5 -10 1
10 30 -5
\`\`\`
**Sample Output 1**
\`\`\`
7
\`\`\`
**Explanation:** Path right→right→down→down: cells -2, -3, 3, 1, -5. With health 7: 7→5→2→5→6→1. Never drops below 1.

---

**Sample Input 2**
\`\`\`
1 1
0
\`\`\`
**Sample Output 2**
\`\`\`
1
\`\`\`

---

**Constraints**
- $1 \\le R, C \\le 200$
- $-1000 \\le \\text{grid}[i][j] \\le 1000$

**Hint:** Work **backwards** from the bottom-right. $dp[i][j] = \\max(\\min(dp[i+1][j], dp[i][j+1]) - grid[i][j],\\; 1)$.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["3 3\n-2 -3 3\n-5 -10 1\n10 30 -5", "7"],
        ["1 1\n0", "1"],
      ],
      [
        gen(solveDungeon, "2 2\n1 2\n3 4"),
        gen(solveDungeon, "2 2\n-1 -2\n-3 -4"),
        gen(solveDungeon, "1 1\n-5"),
        gen(solveDungeon, "1 1\n100"),
        gen(solveDungeon, "1 4\n-3 5 -2 10"),
        gen(solveDungeon, "4 1\n-1\n-2\n-3\n10"),
        gen(solveDungeon, "2 2\n-10 -10\n-10 100"),
        gen(solveDungeon, "3 3\n0 0 0\n0 0 0\n0 0 0"),
        gen(solveDungeon, gridInput(8, 8, -50, 50)),
        gen(solveDungeon, gridInput(10, 10, -100, 100)),
        gen(solveDungeon, gridInput(15, 12, -80, 80)),
        gen(solveDungeon, gridInput(20, 20, -100, 100)),
        gen(solveDungeon, gridInput(50, 50, -200, 200)),
        gen(solveDungeon, gridInput(80, 80, -500, 500)),
        gen(solveDungeon, gridInput(100, 100, -1000, 1000)),
        gen(solveDungeon, gridInput(150, 150, -500, 500)),
        gen(solveDungeon, gridInput(200, 200, -1000, 1000)),
        gen(solveDungeon, gridInput(200, 200, -500, 500)),
      ]
    ),
  },

  // ── Q5: Gold Collection ──
  {
    title: "Gold Collection",
    topic: "Grid DP",
    difficulty: "medium",
    statement: `You are given a grid of $R$ rows and $C$ columns filled with **non-negative integers** representing gold in each cell.

You may start from **any cell in the first column** (column 0). From any cell $(i, j)$, you can move to:
- $(i, j+1)$ — right
- $(i-1, j+1)$ — right-up (if $i > 0$)
- $(i+1, j+1)$ — right-down (if $i < R-1$)

Find the **maximum gold** you can collect.

---

**Input Format**

- First line: two integers $R$ and $C$ $(1 \\le R, C \\le 200)$
- Next $R$ lines: $C$ space-separated non-negative integers $(0 \\le \\text{val} \\le 1000)$

**Output Format**

Print a single integer — the maximum gold.

---

**Sample Input 1**
\`\`\`
3 3
1 3 3
2 1 4
0 6 4
\`\`\`
**Sample Output 1**
\`\`\`
12
\`\`\`
**Explanation:** Start at (1,0)=2, move right-down to (2,1)=6, move right-up to (1,2)=4. Total = 2+6+4 = 12.

---

**Sample Input 2**
\`\`\`
4 4
1 3 1 5
2 2 4 1
5 0 2 3
0 6 1 2
\`\`\`
**Sample Output 2**
\`\`\`
16
\`\`\`

---

**Constraints**
- $1 \\le R, C \\le 200$
- $0 \\le \\text{grid}[i][j] \\le 1000$

**Hint:** Process columns left to right. $dp[i][j] = grid[i][j] + \\max(dp[i][j-1],\\, dp[i-1][j-1],\\, dp[i+1][j-1])$.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["3 3\n1 3 3\n2 1 4\n0 6 4", "12"],
        ["4 4\n1 3 1 5\n2 2 4 1\n5 0 2 3\n0 6 1 2", "16"],
      ],
      [
        gen(solveGold, "1 1\n7"),
        gen(solveGold, "3 1\n1\n5\n3"),
        gen(solveGold, "1 4\n1 2 3 4"),
        gen(solveGold, "3 3\n0 0 0\n0 0 0\n0 0 0"),
        gen(solveGold, "3 3\n10 0 0\n0 10 0\n0 0 10"),
        gen(solveGold, gridInput(10, 10, 0, 100)),
        gen(solveGold, gridInput(15, 15, 0, 200)),
        gen(solveGold, gridInput(20, 20, 0, 500)),
        gen(solveGold, gridInput(30, 30, 0, 1000)),
        gen(solveGold, gridInput(50, 50, 0, 1000)),
        gen(solveGold, gridInput(80, 80, 0, 1000)),
        gen(solveGold, gridInput(100, 100, 0, 1000)),
        gen(solveGold, gridInput(150, 150, 0, 1000)),
        gen(solveGold, gridInput(200, 200, 0, 500)),
        gen(solveGold, gridInput(200, 200, 0, 1000)),
        gen(solveGold, gridInput(200, 200, 0, 1000)),
        gen(solveGold, gridInput(200, 200, 0, 0)),
        gen(solveGold, gridInput(200, 1, 0, 1000)),
      ]
    ),
  },
];

// ── Seed ──

async function main() {
  console.log("Creating HOPE Day 4 — Level 4: Grid DP...\n");

  const questionIds: string[] = [];

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    const [{ id }] = await sql<[{ id: string }]>`
      INSERT INTO questions (title, statement, time_limit_ms, memory_limit_kb, created_by, topic, difficulty)
      VALUES (${q.title}, ${q.statement}, ${q.time_limit_ms}, ${q.memory_limit_kb}, ${ADMIN_ID}, ${q.topic}, ${q.difficulty})
      RETURNING id
    `;
    questionIds.push(id);

    for (let ord = 0; ord < q.test_cases.length; ord++) {
      const tc = q.test_cases[ord];
      await sql`
        INSERT INTO test_cases (question_id, ord, input, expected_output, is_sample)
        VALUES (${id}, ${ord + 1}, ${tc.input}, ${tc.output}, ${tc.is_sample})
      `;
    }

    const sampleCount = q.test_cases.filter((t) => t.is_sample).length;
    const hiddenCount = q.test_cases.filter((t) => !t.is_sample).length;
    console.log(`  Q${i + 1}: "${q.title}" — ${sampleCount} sample + ${hiddenCount} hidden [id: ${id}]`);
  }

  const instructions = `## Instructions

- This is a **1-hour** timed assessment. Your timer starts the moment you open the exam.
- You may use **C, C++, Python, or Java**.
- Each problem has **2 visible sample test cases** to help you verify your approach, and **18 hidden test cases** used for grading.
- Questions cover **Grid Dynamic Programming**: minimum path sum, obstacle paths, maximal square, dungeon game, and gold collection.
- Read each problem statement carefully, paying attention to constraints and edge cases.
- Partial credit is awarded per test case — a correct solution that passes all 20 cases earns full marks.
- Do **not** refresh the page or navigate away once you start.
- Good luck!`;

  const [{ id: examId }] = await sql<[{ id: string }]>`
    INSERT INTO exams (
      title, instructions, starts_at, ends_at, duration_minutes,
      languages, batches, published, created_by,
      require_fullscreen, block_external_paste, require_seb
    ) VALUES (
      ${"HOPE Day 4 — Level 4: Grid DP"},
      ${instructions},
      '2026-10-10 07:50:00+05:30',
      '2026-10-10 09:20:00+05:30',
      60,
      ARRAY['c','cpp','python','java'],
      ${BATCHES}::text[],
      true,
      ${ADMIN_ID},
      true,
      true,
      true
    )
    RETURNING id
  `;

  console.log(`\n  Exam created: "${examId}"`);

  for (let i = 0; i < questionIds.length; i++) {
    await sql`
      INSERT INTO exam_questions (exam_id, question_id, ord, points, slot)
      VALUES (${examId}, ${questionIds[i]}, ${i + 1}, 100, ${i + 1})
    `;
  }

  console.log(`\n✓ HOPE Day 4 — Level 4: Grid DP ready`);
  console.log(`  Exam ID: ${examId}`);
  console.log(`  Questions: ${questionIds.length}`);
  console.log(`  Window: Oct 10, 2026 — 7:50 AM to 9:20 AM IST`);
  console.log(`  Duration: 60 minutes`);
  console.log(`  Batches: ${BATCHES.join(", ")}`);
  console.log(`  Integrity: require_fullscreen=true, block_external_paste=true, require_seb=true`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
