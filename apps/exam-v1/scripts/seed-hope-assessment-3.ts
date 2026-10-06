/**
 * HOPE Assessment — Level 4: Grid Dynamic Programming
 * Oct 8, 2026 | 6:00 PM – 10:00 PM IST | 120 minutes
 * 5 questions × 20 test cases (2 sample + 18 hidden)
 * Languages: c, cpp, python, java
 * Mapped to all 14 HOPE batches
 */

import { sql } from "../lib/db.ts";

const ADMIN_ID = "2cabecf4-74f4-461c-b596-d0fee3fb88b5";

const HOPE_BATCHES = [
  "2Y-HOPE-ELITE",
  "2Y-HOPE-B1",
  "2Y-HOPE-B2",
  "2Y-HOPE-B3",
  "2Y-HOPE-B4",
  "3Y-HOPE-ELITE",
  "3Y-HOPE-B1",
  "3Y-HOPE-B2",
  "3Y-HOPE-B3",
  "3Y-HOPE-B4",
  "3Y-HOPE-B5",
  "3Y-HOPE-B6",
  "3Y-HOPE-B7",
  "3Y-HOPE-B8",
];

interface TestCase {
  input: string;
  output: string;
  is_sample: boolean;
}

interface Question {
  title: string;
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

const QUESTIONS: Question[] = [

  // ── Q1: Paths Through the Grid ──────────────────────────────────────────
  {
    title: "Paths Through the Grid",
    statement: `A robot is placed at the **top-left corner** of an $M \\times N$ grid (row $1$, column $1$). It wants to reach the **bottom-right corner** (row $M$, column $N$).

The robot can only move in **two directions**: right or down — one step at a time.

Count the **total number of unique paths** the robot can take to reach the destination.

Since the answer can be very large, output it **modulo $10^9 + 7$**.

---

**Input Format**

A single line containing two integers $M$ and $N$ — the number of rows and columns $(1 \\le M, N \\le 100)$.

**Output Format**

Print a single integer — the number of unique paths, modulo $10^9 + 7$.

---

**Sample Input 1**
\`\`\`
3 7
\`\`\`
**Sample Output 1**
\`\`\`
28
\`\`\`
**Explanation:** With a $3 \\times 7$ grid, the robot needs to take exactly $2$ steps down and $6$ steps right, in any order. The number of ways to arrange $2$ downs among $8$ total steps is $\\binom{8}{2} = 28$.

---

**Sample Input 2**
\`\`\`
3 3
\`\`\`
**Sample Output 2**
\`\`\`
6
\`\`\`
**Explanation:** In a $3 \\times 3$ grid, there are $6$ ways to go from top-left to bottom-right using only right and down moves.

---

**Constraints**
- $1 \\le M, N \\le 100$
- Output the answer modulo $10^9 + 7$

**Hint:** Let $dp[i][j]$ = number of paths to reach cell $(i, j)$. Then $dp[i][j] = dp[i-1][j] + dp[i][j-1]$, with $dp[1][j] = dp[i][1] = 1$ for all $i, j$.`,
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
        ["2 3", "3"],
        ["3 2", "3"],
        ["4 4", "20"],
        ["5 5", "70"],
        ["10 10", "48620"],
        ["100 100", "407336795"],
        ["2 100", "100"],
        ["100 2", "100"],
        ["50 50", "605405732"],
        ["7 3", "28"],
        ["6 6", "252"],
        ["20 20", "137846528"],
        ["15 10", "817190"],
        ["10 15", "817190"],
      ]
    ),
  },

  // ── Q2: Paths Around the Obstacles ──────────────────────────────────────
  {
    title: "Paths Around the Obstacles",
    statement: `A robot starts at the **top-left corner** of an $M \\times N$ grid and wants to reach the **bottom-right corner**. It can only move **right** or **down**.

However, this grid has **obstacles** — cells marked with $1$ that the robot cannot enter. Empty cells are marked $0$.

Count the **total number of unique paths** that avoid all obstacles.

Since the answer can be large, output it **modulo $10^9 + 7$**.

---

**Input Format**

- First line: two integers $M$ and $N$ $(1 \\le M, N \\le 100)$
- Next $M$ lines: $N$ space-separated integers, each $0$ (empty) or $1$ (obstacle)

**Output Format**

Print a single integer — the number of unique paths, modulo $10^9 + 7$. Print $0$ if no path exists.

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
**Explanation:** The obstacle at $(2,2)$ (1-indexed) blocks two of the usual 6 paths. The two remaining paths are:
- Right → Right → Down → Down
- Down → Down → Right → Right

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
**Explanation:** The top-right cell is blocked, so the only path is Down → Right.

---

**Constraints**
- $1 \\le M, N \\le 100$
- Each cell is $0$ or $1$
- The start $(1,1)$ and end $(M,N)$ are always $0$

**Hint:** $dp[i][j] = 0$ if there's an obstacle at $(i,j)$; otherwise $dp[i][j] = dp[i-1][j] + dp[i][j-1]$.`,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["3 3\n0 0 0\n0 1 0\n0 0 0", "2"],
        ["2 2\n0 1\n0 0", "1"],
      ],
      [
        // No obstacles
        ["3 3\n0 0 0\n0 0 0\n0 0 0", "6"],
        // 1×1 grid
        ["1 1\n0", "1"],
        // Obstacle in first column — blocks all paths using that cell
        ["3 3\n0 0 0\n1 0 0\n0 0 0", "3"],
        // Obstacle in first row — forces going down first
        ["3 3\n0 1 0\n0 0 0\n0 0 0", "3"],
        // Fully blocked first row middle
        ["2 3\n0 1 0\n0 0 0", "1"],
        // Blocked middle column
        ["3 3\n0 0 0\n0 0 1\n0 0 0", "3"],
        // Large grid, no obstacles
        ["10 10\n0 0 0 0 0 0 0 0 0 0\n0 0 0 0 0 0 0 0 0 0\n0 0 0 0 0 0 0 0 0 0\n0 0 0 0 0 0 0 0 0 0\n0 0 0 0 0 0 0 0 0 0\n0 0 0 0 0 0 0 0 0 0\n0 0 0 0 0 0 0 0 0 0\n0 0 0 0 0 0 0 0 0 0\n0 0 0 0 0 0 0 0 0 0\n0 0 0 0 0 0 0 0 0 0", "48620"],
        // Diagonal wall of obstacles
        ["4 4\n0 0 0 0\n0 1 0 0\n0 0 1 0\n0 0 0 0", "4"],
        // Single row with obstacle in middle — impossible
        ["1 4\n0 0 1 0", "0"],
        // Single column with obstacle
        ["4 1\n0\n0\n1\n0", "0"],
        // Obstacle near end
        ["3 3\n0 0 0\n0 0 0\n0 1 0", "3"],
        // Obstacle blocks most paths but one survives
        ["4 4\n0 0 0 0\n0 1 1 0\n0 1 1 0\n0 0 0 0", "2"],
        // All blocked except perimeter
        ["3 4\n0 0 0 0\n1 1 1 0\n0 0 0 0", "1"],
        // Two separate obstacles
        ["4 4\n0 0 0 0\n1 0 0 0\n0 0 0 1\n0 0 0 0", "10"],
        // Completely blocked (impossible)
        ["3 3\n0 1 0\n1 0 0\n0 0 0", "0"],
        // 2×10 no obstacles
        ["2 10\n0 0 0 0 0 0 0 0 0 0\n0 0 0 0 0 0 0 0 0 0", "10"],
        // Large, half blocked
        ["5 5\n0 0 0 0 0\n0 1 0 1 0\n0 0 0 0 0\n0 1 0 1 0\n0 0 0 0 0", "8"],
      ]
    ),
  },

  // ── Q3: Cheapest Route ───────────────────────────────────────────────────
  {
    title: "Cheapest Route",
    statement: `You have a grid of $M$ rows and $N$ columns. Each cell $(i, j)$ has a **cost** — the amount you pay when you step into that cell.

Starting from the **top-left cell** $(1, 1)$, you want to reach the **bottom-right cell** $(M, N)$. You can only move **right** or **down** at each step.

Find the **minimum total cost** of any path from top-left to bottom-right. The cost includes **both** the starting and ending cells.

---

**Input Format**

- First line: two integers $M$ and $N$ $(1 \\le M, N \\le 200)$
- Next $M$ lines: $N$ space-separated integers — the cost of each cell $(1 \\le \\text{cost}[i][j] \\le 100)$

**Output Format**

Print a single integer — the minimum path cost.

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
**Explanation:** The cheapest path is $(1,1) \\to (1,2) \\to (1,3) \\to (2,3) \\to (3,3)$, with total cost $1 + 3 + 1 + 1 + 1 = 7$.

---

**Sample Input 2**
\`\`\`
2 3
1 2 5
4 2 1
\`\`\`
**Sample Output 2**
\`\`\`
6
\`\`\`
**Explanation:** Take the path $(1,1) \\to (2,1) \\to (2,2) \\to (2,3)$, costing $1 + 4 + 2 + 1 = 8$... or $(1,1) \\to (1,2) \\to (2,2) \\to (2,3)$, costing $1 + 2 + 2 + 1 = 6$. The second is cheaper.

---

**Constraints**
- $1 \\le M, N \\le 200$
- $1 \\le \\text{cost}[i][j] \\le 100$

**Hint:** Let $dp[i][j]$ = minimum cost to reach $(i,j)$. Then:
$$dp[i][j] = \\text{cost}[i][j] + \\min(dp[i-1][j],\\ dp[i][j-1])$$
with $dp[1][1] = \\text{cost}[1][1]$.`,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["3 3\n1 3 1\n1 5 1\n4 2 1", "7"],
        ["2 3\n1 2 5\n4 2 1", "6"],
      ],
      [
        // 1×1 grid
        ["1 1\n5", "5"],
        // 1×N — only one path
        ["1 4\n1 2 3 4", "10"],
        // M×1 — only one path
        ["4 1\n1\n2\n3\n4", "10"],
        // All same cost
        ["3 3\n2 2 2\n2 2 2\n2 2 2", "10"],
        // Go right first (cheaper)
        ["2 2\n1 1\n5 1", "3"],
        // Go down first (cheaper)
        ["2 2\n1 5\n1 1", "3"],
        // Large costs except optimal path
        ["3 3\n1 100 100\n100 100 100\n100 100 1", "201"],
        // Uniform grid 5×5
        ["5 5\n1 1 1 1 1\n1 1 1 1 1\n1 1 1 1 1\n1 1 1 1 1\n1 1 1 1 1", "9"],
        // Optimal goes through middle
        ["4 4\n9 9 9 9\n9 1 1 9\n9 1 1 9\n9 9 9 9", "31"],
        // Cost increases diagonally
        ["3 4\n1 2 3 4\n5 6 7 8\n9 10 11 12", "31"],
        // Single row high cost at end
        ["1 5\n1 1 1 1 100", "104"],
        // Cheap diagonal wins
        ["4 4\n1 100 100 100\n100 1 100 100\n100 100 1 100\n100 100 100 1", "4"],
        // 2×2 all 1s
        ["2 2\n1 1\n1 1", "3"],
        // 2×2, right then down cheaper
        ["2 2\n1 3\n4 1", "5"],
        // All max cost
        ["3 3\n100 100 100\n100 100 100\n100 100 100", "500"],
        // Path heavily penalizes one direction
        ["3 4\n1 1 1 1\n1 99 99 1\n1 1 1 1", "7"],
        // Zigzag savings
        ["4 4\n1 2 1 2\n2 1 2 1\n1 2 1 2\n2 1 2 1", "9"],
        // Large uniform — verify formula
        ["10 10\n1 1 1 1 1 1 1 1 1 1\n1 1 1 1 1 1 1 1 1 1\n1 1 1 1 1 1 1 1 1 1\n1 1 1 1 1 1 1 1 1 1\n1 1 1 1 1 1 1 1 1 1\n1 1 1 1 1 1 1 1 1 1\n1 1 1 1 1 1 1 1 1 1\n1 1 1 1 1 1 1 1 1 1\n1 1 1 1 1 1 1 1 1 1\n1 1 1 1 1 1 1 1 1 1", "19"],
      ]
    ),
  },

  // ── Q4: Triangle Descent ─────────────────────────────────────────────────
  {
    title: "Triangle Descent",
    statement: `You are given a **triangle** of integers arranged as follows:

\`\`\`
   2
  3 4
 6 5 7
4 1 8 3
\`\`\`

Starting from the **top** (a single element), at each step you can move to one of the **two adjacent elements** in the row directly below.

Find the **minimum path sum** from the top to any element in the **bottom row**.

---

**Input Format**

- First line: an integer $N$ — the number of rows $(1 \\le N \\le 200)$
- Next $N$ lines: the $i$-th line (1-indexed) contains $i$ space-separated integers — the elements of that row

**Output Format**

Print a single integer — the minimum path sum from top to bottom.

---

**Sample Input 1**
\`\`\`
4
2
3 4
6 5 7
4 1 8 3
\`\`\`
**Sample Output 1**
\`\`\`
11
\`\`\`
**Explanation:** The path $2 \\to 3 \\to 5 \\to 1$ gives sum $2 + 3 + 5 + 1 = 11$, which is the minimum possible.

---

**Sample Input 2**
\`\`\`
1
7
\`\`\`
**Sample Output 2**
\`\`\`
7
\`\`\`
**Explanation:** Only one element — the answer is $7$.

---

**Constraints**
- $1 \\le N \\le 200$
- $-10^4 \\le \\text{triangle}[i][j] \\le 10^4$ (values can be negative)

**Hint:** Work **bottom-up**: starting from the second-to-last row, replace each element with itself plus the minimum of the two elements directly below it. After processing all rows, the answer is at the top.`,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["4\n2\n3 4\n6 5 7\n4 1 8 3", "11"],
        ["1\n7", "7"],
      ],
      [
        // 2 rows
        ["2\n1\n2 3", "3"],
        // All same value
        ["3\n5\n5 5\n5 5 5", "15"],
        // Negative values — minimum path still works
        ["3\n-1\n-2 -3\n-4 -5 -6", "-10"],
        // Large negative at tip
        ["3\n-10\n1 1\n1 1 1", "-8"],
        // Path prefers left
        ["4\n1\n1 2\n1 2 3\n1 2 3 4", "4"],
        // Path prefers right
        ["4\n1\n2 1\n3 2 1\n4 3 2 1", "4"],
        // All zeros
        ["3\n0\n0 0\n0 0 0", "0"],
        // Mix of positive and negative
        ["4\n5\n-1 3\n2 -4 1\n3 2 -5 4", "-5"],
        // Large triangle, uniform 1s
        ["5\n1\n1 1\n1 1 1\n1 1 1 1\n1 1 1 1 1", "5"],
        // Best path zigzags
        ["5\n1\n2 1\n1 2 1\n2 1 2 1\n1 2 1 2 1", "5"],
        // Large values
        ["3\n10000\n10000 10000\n10000 10000 10000", "30000"],
        // Mixed sign, answer at specific bottom cell
        ["4\n3\n7 4\n2 4 6\n8 5 9 3", "15"],
        // Only right children matter
        ["4\n0\n100 0\n100 100 0\n100 100 100 0", "0"],
        // Only left children matter
        ["4\n0\n0 100\n0 100 100\n0 100 100 100", "0"],
        // Alternating positive-negative rows
        ["4\n1\n-1 -1\n1 1 1\n-1 -1 -1 -1", "-2"],
        // All max negative
        ["3\n-10000\n-10000 -10000\n-10000 -10000 -10000", "-30000"],
        // n=200 stress — all 1s (answer = 200)
        // We'll use n=10 uniform instead for tractability in seed
        ["10\n1\n1 1\n1 1 1\n1 1 1 1\n1 1 1 1 1\n1 1 1 1 1 1\n1 1 1 1 1 1 1\n1 1 1 1 1 1 1 1\n1 1 1 1 1 1 1 1 1\n1 1 1 1 1 1 1 1 1 1", "10"],
        // Classic example
        ["4\n-10\n9 -8\n1 2 3\n10 20 30 40", "-7"],
      ]
    ),
  },

  // ── Q5: Staircase Ways ───────────────────────────────────────────────────
  {
    title: "Staircase Ways",
    statement: `You are standing at the bottom of a staircase with $N$ steps. At each move, you can climb either **1 step** or **2 steps**.

Count the **total number of distinct ways** to reach the top (step $N$) from the ground (step $0$).

Since the answer can be very large, output it **modulo $10^9 + 7$**.

---

**Input Format**

A single integer $N$ — the number of steps $(1 \\le N \\le 10^6)$.

**Output Format**

Print a single integer — the number of distinct ways to climb $N$ steps, modulo $10^9 + 7$$.

---

**Sample Input 1**
\`\`\`
4
\`\`\`
**Sample Output 1**
\`\`\`
5
\`\`\`
**Explanation:** The $5$ ways to climb $4$ steps are:
1. $1+1+1+1$
2. $1+1+2$
3. $1+2+1$
4. $2+1+1$
5. $2+2$

---

**Sample Input 2**
\`\`\`
6
\`\`\`
**Sample Output 2**
\`\`\`
13
\`\`\`
**Explanation:** There are $13$ distinct sequences of $1$s and $2$s that sum to $6$.

---

**Constraints**
- $1 \\le N \\le 10^6$
- Output the answer modulo $10^9 + 7$

**Hint:** Let $f(n)$ = number of ways to reach step $n$. Then:
$$f(n) = f(n-1) + f(n-2)$$
with $f(1) = 1$ and $f(2) = 2$.

This is the **Fibonacci sequence** shifted by one position.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["4", "5"],
        ["6", "13"],
      ],
      [
        ["1", "1"],
        ["2", "2"],
        ["3", "3"],
        ["5", "8"],
        ["7", "21"],
        ["8", "34"],
        ["10", "89"],
        ["15", "987"],
        ["20", "10946"],
        ["30", "1346269"],
        ["40", "165580141"],
        ["50", "20365011074"],
        ["100", "927372692"],
        ["1000", "517691607"],
        ["10000", "717158526"],
        ["100000", "327697435"],
        ["1000000", "208283815"],
        ["999999", "707538751"],
      ]
    ),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Creating HOPE Assessment — Level 4...\n");

  const questionIds: string[] = [];

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    const [{ id }] = await sql<[{ id: string }]>`
      INSERT INTO questions (title, statement, time_limit_ms, memory_limit_kb, created_by)
      VALUES (${q.title}, ${q.statement}, ${q.time_limit_ms}, ${q.memory_limit_kb}, ${ADMIN_ID})
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

  const [{ id: examId }] = await sql<[{ id: string }]>`
    INSERT INTO exams (
      title, instructions, starts_at, ends_at, duration_minutes,
      languages, batches, published, created_by
    ) VALUES (
      'HOPE Assessment — Level 4',
      ${'## Instructions\n\n- This is a **2-hour** timed assessment. Your timer starts the moment you open the exam.\n- You may use **C, C++, Python, or Java**.\n- Each problem has **2 visible sample test cases** to help you verify your approach, and **18 hidden test cases** used for grading.\n- Read each problem statement carefully, paying attention to constraints and edge cases.\n- Partial credit is awarded per test case — a correct solution that passes all 20 cases earns full marks.\n- Do **not** refresh the page or navigate away once you start.\n- Good luck!'},
      '2026-10-08 18:00:00+05:30',
      '2026-10-08 22:00:00+05:30',
      120,
      ARRAY['c','cpp','python','java'],
      ${HOPE_BATCHES}::text[],
      true,
      ${ADMIN_ID}
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

  console.log(`\n✓ HOPE Assessment — Level 4 ready`);
  console.log(`  Exam ID: ${examId}`);
  console.log(`  Questions: ${questionIds.length}`);
  console.log(`  Window: Oct 8, 2026 — 6:00 PM to 10:00 PM IST`);
  console.log(`  Duration: 120 minutes`);
  console.log(`  Batches: ${HOPE_BATCHES.join(", ")}`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
