/**
 * HOPE Day 3 — Level 4: Knapsack & Partition DP
 * Oct 7, 2026 | 6:00 PM – 10:00 PM IST | 120 minutes
 * 5 questions × 20 test cases (2 sample + 18 hidden)
 * Languages: c, cpp, python, java
 * Mapped to: 3Y-HOPE-B2, 3Y-HOPE-B3, SEB-TEST
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

  // ── Q1: Partition Equal Subset Sum ─────────────────────────────────────
  {
    title: "Partition Equal Subset Sum",
    statement: `Given an array of **positive integers**, determine whether it can be partitioned into **two subsets** such that the sum of elements in both subsets is equal.

---

**Input Format**

- First line: an integer $N$ — the number of elements $(1 \\le N \\le 200)$
- Second line: $N$ space-separated positive integers $(1 \\le \\text{nums}[i] \\le 100)$

**Output Format**

Print \`YES\` if the array can be partitioned into two subsets with equal sum, otherwise print \`NO\`.

---

**Sample Input 1**
\`\`\`
4
1 5 11 5
\`\`\`
**Sample Output 1**
\`\`\`
YES
\`\`\`
**Explanation:** The array can be partitioned as $\\{1, 5, 5\\}$ and $\\{11\\}$, both summing to $11$.

---

**Sample Input 2**
\`\`\`
3
1 2 3
\`\`\`
**Sample Output 2**
\`\`\`
YES
\`\`\`
**Explanation:** Partition: $\\{1, 2\\}$ (sum $3$) and $\\{3\\}$ (sum $3$).

---

**Constraints**
- $1 \\le N \\le 200$
- $1 \\le \\text{nums}[i] \\le 100$

**Hint:** This is a variant of the **0/1 Knapsack** problem. If the total sum is odd, the answer is immediately \`NO\`. Otherwise, check if a subset with sum $\\text{total}/2$ exists using a boolean DP array: \`dp[j] = true\` if sum \`j\` is achievable. Iterate each number and update from right to left: \`dp[j] |= dp[j - num]\`.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["4\n1 5 11 5", "YES"],
        ["3\n1 2 3", "YES"],
      ],
      [
        ["3\n1 2 5", "NO"],
        ["1\n1", "NO"],
        ["2\n1 1", "YES"],
        ["1\n0", "YES"],
        ["5\n1 2 3 4 10", "YES"],
        ["4\n3 3 3 3", "YES"],
        ["4\n1 1 1 1", "YES"],
        ["3\n1 1 2", "YES"],
        ["5\n2 2 2 2 2", "NO"],
        ["6\n1 1 1 1 1 1", "YES"],
        ["4\n100 100 100 100", "YES"],
        ["3\n1 2 4", "NO"],
        ["5\n3 3 3 4 4", "NO"],
        ["4\n1 6 11 6", "YES"],
        ["6\n1 2 3 4 5 5", "YES"],
        ["4\n2 4 6 8", "YES"],
        ["5\n7 7 7 7 7", "NO"],
        ["3\n10 10 10", "NO"],
      ]
    ),
  },

  // ── Q2: Target Sum ─────────────────────────────────────────────────────
  {
    title: "Target Sum",
    statement: `You are given an array of **non-negative integers** and a target value $S$. You must assign a **+** or **−** sign to each element of the array such that the sum of all signed elements equals $S$.

Return the **number of different ways** you can assign signs to make the sum equal to $S$.

---

**Input Format**

- First line: an integer $N$ — the number of elements $(1 \\le N \\le 20)$
- Second line: $N$ space-separated non-negative integers $(0 \\le \\text{nums}[i] \\le 1000)$
- Third line: an integer $S$ — the target sum $(-10000 \\le S \\le 10000)$

**Output Format**

Print a single integer — the number of ways to achieve the target sum $S$.

---

**Sample Input 1**
\`\`\`
5
1 1 1 1 1
3
\`\`\`
**Sample Output 1**
\`\`\`
5
\`\`\`
**Explanation:** There are 5 ways to assign signs:
$-1+1+1+1+1 = 3$, $+1-1+1+1+1 = 3$, $+1+1-1+1+1 = 3$, $+1+1+1-1+1 = 3$, $+1+1+1+1-1 = 3$.

---

**Sample Input 2**
\`\`\`
1
1
1
\`\`\`
**Sample Output 2**
\`\`\`
1
\`\`\`
**Explanation:** Only $+1 = 1$.

---

**Constraints**
- $1 \\le N \\le 20$
- $0 \\le \\text{nums}[i] \\le 1000$
- $-10000 \\le S \\le 10000$

**Hint:** Let $P$ be the sum of elements assigned $+$ and $Q$ the sum of elements assigned $-$. Then $P - Q = S$ and $P + Q = \\text{total}$. So $P = (S + \\text{total}) / 2$. If $(S + \\text{total})$ is odd or negative, the answer is $0$. Otherwise, count subsets with sum $P$ using a 0/1 knapsack DP. Be careful with zeros — each zero doubles the count.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["5\n1 1 1 1 1\n3", "5"],
        ["1\n1\n1", "1"],
      ],
      [
        ["1\n0\n0", "2"],
        ["2\n1 0\n1", "2"],
        ["3\n1 2 3\n0", "2"],
        ["2\n1 1\n0", "2"],
        ["4\n1 1 1 1\n0", "6"],
        ["4\n1 1 1 1\n2", "4"],
        ["4\n1 1 1 1\n4", "1"],
        ["3\n2 3 5\n0", "2"],
        ["2\n1 2\n3", "1"],
        ["2\n1 2\n1", "1"],
        ["3\n0 0 0\n0", "8"],
        ["5\n1 1 1 1 1\n5", "1"],
        ["5\n1 1 1 1 1\n1", "10"],
        ["3\n1 2 3\n6", "1"],
        ["3\n1 2 3\n2", "1"],
        ["4\n2 2 2 2\n0", "6"],
        ["3\n1 1 1\n3", "1"],
        ["3\n1 1 1\n1", "3"],
      ]
    ),
  },

  // ── Q3: Ones and Zeroes ────────────────────────────────────────────────
  {
    title: "Ones and Zeroes",
    statement: `You are given an array of **binary strings** (each string contains only characters \`'0'\` and \`'1'\`) and two integers $m$ and $n$.

Find the **maximum number of strings** you can select from the array such that the **total number of \`0\`s** among the selected strings is at most $m$ and the **total number of \`1\`s** is at most $n$.

Each string can be selected **at most once**.

---

**Input Format**

- First line: an integer $K$ — the number of binary strings $(1 \\le K \\le 600)$
- Second line: $K$ space-separated binary strings (each of length $1$ to $100$)
- Third line: two integers $m$ and $n$ — the maximum allowed zeros and ones $(0 \\le m, n \\le 100)$

**Output Format**

Print a single integer — the maximum number of strings that can be selected.

---

**Sample Input 1**
\`\`\`
5
10 0001 111001 1 0
5 3
\`\`\`
**Sample Output 1**
\`\`\`
4
\`\`\`
**Explanation:** Select \`"10"\`, \`"0001"\`, \`"1"\`, \`"0"\`. Total zeros = $1 + 3 + 0 + 1 = 5 \\le 5$, total ones = $1 + 1 + 1 + 0 = 3 \\le 3$. We cannot select all 5 because \`"111001"\` alone uses 3 ones.

---

**Sample Input 2**
\`\`\`
3
10 0 1
1 1
\`\`\`
**Sample Output 2**
\`\`\`
2
\`\`\`
**Explanation:** Select \`"0"\` and \`"1"\`. Total: 1 zero, 1 one.

---

**Constraints**
- $1 \\le K \\le 600$
- $1 \\le \\text{len}(\\text{strs}[i]) \\le 100$
- $0 \\le m, n \\le 100$

**Hint:** This is a **2-dimensional 0/1 knapsack**. Let \`dp[i][j]\` = maximum strings selectable using at most \`i\` zeros and \`j\` ones. For each string with \`z\` zeros and \`o\` ones, iterate \`i\` from $m$ down to $z$ and \`j\` from $n$ down to $o$: \`dp[i][j] = max(dp[i][j], dp[i-z][j-o] + 1)\`.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["5\n10 0001 111001 1 0\n5 3", "4"],
        ["3\n10 0 1\n1 1", "2"],
      ],
      [
        ["1\n0\n1 0", "1"],
        ["1\n1\n0 1", "1"],
        ["1\n11\n0 1", "0"],
        ["2\n0 0\n2 0", "2"],
        ["3\n01 10 11\n1 1", "1"],
        ["4\n0 0 0 0\n4 0", "4"],
        ["4\n1 1 1 1\n0 4", "4"],
        ["3\n00 11 01\n2 2", "2"],
        ["4\n0 1 10 01\n2 2", "3"],
        ["2\n0 1\n0 0", "0"],
        ["5\n0 0 1 1 10\n3 2", "4"],
        ["3\n000 111 010\n3 3", "2"],
        ["6\n0 1 0 1 0 1\n3 3", "6"],
        ["4\n10 10 10 10\n4 4", "4"],
        ["3\n110 10 0\n2 2", "2"],
        ["2\n0 1\n1 1", "2"],
        ["1\n01\n1 1", "1"],
        ["3\n10 01 00\n3 1", "2"],
      ]
    ),
  },

  // ── Q4: Coin Change II ─────────────────────────────────────────────────
  {
    title: "Coin Change II",
    statement: `You are given coins of different denominations and a total amount of money. Find the **number of combinations** that make up that amount. You may use each coin denomination **an unlimited number of times**.

If the amount cannot be made up by any combination of the coins, return $0$.

---

**Input Format**

- First line: an integer $\\text{amount}$ — the target amount $(0 \\le \\text{amount} \\le 5000)$
- Second line: an integer $N$ — the number of coin denominations $(1 \\le N \\le 300)$
- Third line: $N$ space-separated positive integers — the coin values $(1 \\le \\text{coins}[i] \\le 5000)$

**Output Format**

Print a single integer — the number of **combinations** (not permutations) that sum to \`amount\`.

---

**Sample Input 1**
\`\`\`
5
3
1 2 5
\`\`\`
**Sample Output 1**
\`\`\`
4
\`\`\`
**Explanation:** There are 4 combinations:
- $5 = 5$
- $5 = 2 + 2 + 1$
- $5 = 2 + 1 + 1 + 1$
- $5 = 1 + 1 + 1 + 1 + 1$

---

**Sample Input 2**
\`\`\`
3
2
1 2
\`\`\`
**Sample Output 2**
\`\`\`
2
\`\`\`
**Explanation:** $3 = 1 + 1 + 1$ and $3 = 1 + 2$.

---

**Constraints**
- $0 \\le \\text{amount} \\le 5000$
- $1 \\le N \\le 300$
- $1 \\le \\text{coins}[i] \\le 5000$
- All coin values are **distinct**

**Hint:** Use an **unbounded knapsack** DP. Let \`dp[j]\` = number of combinations to make amount \`j\`. Initialize \`dp[0] = 1\`. For each coin (outer loop), iterate amounts from \`coin\` to \`amount\` (inner loop): \`dp[j] += dp[j - coin]\`. The outer-coin-inner-amount order avoids counting permutations as distinct combinations.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["5\n3\n1 2 5", "4"],
        ["3\n2\n1 2", "2"],
      ],
      [
        ["0\n2\n1 2", "1"],
        ["1\n1\n1", "1"],
        ["1\n1\n2", "0"],
        ["2\n1\n1", "1"],
        ["4\n2\n1 2", "3"],
        ["10\n3\n1 2 5", "10"],
        ["6\n3\n1 2 3", "7"],
        ["7\n2\n2 3", "1"],
        ["10\n2\n2 5", "2"],
        ["4\n3\n1 2 3", "4"],
        ["5\n4\n1 2 3 5", "6"],
        ["100\n2\n1 2", "51"],
        ["10\n4\n1 2 5 10", "11"],
        ["3\n3\n1 2 3", "3"],
        ["8\n2\n1 5", "2"],
        ["6\n2\n3 5", "1"],
        ["15\n3\n1 5 10", "6"],
        ["20\n3\n1 5 10", "9"],
      ]
    ),
  },

  // ── Q5: Last Stone Weight II ───────────────────────────────────────────
  {
    title: "Last Stone Weight II",
    statement: `You have a collection of stones, each with a positive integer weight.

Each turn, you pick **any two stones** and smash them together. If the stones have weights $x$ and $y$ with $x \\le y$:
- If $x = y$, both stones are destroyed.
- If $x \\ne y$, the stone of weight $x$ is destroyed and the stone of weight $y$ has new weight $y - x$.

The game ends when there is **at most one stone** left. Return the **smallest possible weight** of the remaining stone (or $0$ if no stones remain).

---

**Input Format**

- First line: an integer $N$ — the number of stones $(1 \\le N \\le 30)$
- Second line: $N$ space-separated positive integers — stone weights $(1 \\le \\text{stones}[i] \\le 100)$

**Output Format**

Print a single integer — the minimum possible weight of the last remaining stone.

---

**Sample Input 1**
\`\`\`
6
2 7 4 1 8 1
\`\`\`
**Sample Output 1**
\`\`\`
1
\`\`\`
**Explanation:** One optimal sequence:
- Smash $2$ and $4$ → $2$, stones: $[7, 2, 1, 8, 1]$
- Smash $7$ and $8$ → $1$, stones: $[2, 1, 1, 1]$
- Smash $2$ and $1$ → $1$, stones: $[1, 1, 1]$
- Smash $1$ and $1$ → $0$, stones: $[1]$

The minimum possible weight is $1$.

---

**Sample Input 2**
\`\`\`
1
1
\`\`\`
**Sample Output 2**
\`\`\`
1
\`\`\`

---

**Constraints**
- $1 \\le N \\le 30$
- $1 \\le \\text{stones}[i] \\le 100$

**Hint:** This is equivalent to partitioning the stones into two groups and minimizing $|\\text{sum}_1 - \\text{sum}_2|$. Use a **subset sum DP**: find the largest achievable sum $S_1 \\le \\text{total}/2$. The answer is $\\text{total} - 2 \\times S_1$. Use a boolean DP array: \`dp[j] = true\` if sum \`j\` is achievable.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["6\n2 7 4 1 8 1", "1"],
        ["1\n1", "1"],
      ],
      [
        ["2\n1 1", "0"],
        ["2\n1 2", "1"],
        ["3\n1 2 3", "0"],
        ["4\n1 1 1 1", "0"],
        ["3\n2 2 2", "2"],
        ["5\n1 5 3 4 2", "1"],
        ["4\n10 10 10 10", "0"],
        ["3\n5 5 5", "5"],
        ["2\n3 7", "4"],
        ["4\n1 2 4 8", "1"],
        ["3\n100 1 1", "98"],
        ["5\n2 2 2 2 2", "2"],
        ["4\n3 3 3 3", "0"],
        ["3\n1 1 100", "98"],
        ["6\n1 1 1 1 1 1", "0"],
        ["4\n5 8 3 2", "2"],
        ["3\n7 3 2", "2"],
        ["5\n4 3 2 1 5", "1"],
      ]
    ),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Creating HOPE Day 3 — Level 4: Knapsack & Partition DP...\n");

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

  const instructions = `## Instructions

- This is a **2-hour** timed assessment. Your timer starts the moment you open the exam.
- You may use **C, C++, Python, or Java**.
- Each problem has **2 visible sample test cases** to help you verify your approach, and **18 hidden test cases** used for grading.
- Questions cover **Knapsack & Partition DP** — subset sum, target sum, 2D knapsack, unbounded knapsack, and partition minimization.
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
      'HOPE Day 3 — Level 4: Knapsack & Partition DP',
      ${instructions},
      '2026-10-07 18:00:00+05:30',
      '2026-10-07 22:00:00+05:30',
      120,
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

  console.log(`\n✓ HOPE Day 3 — Level 4: Knapsack & Partition DP ready`);
  console.log(`  Exam ID: ${examId}`);
  console.log(`  Questions: ${questionIds.length}`);
  console.log(`  Window: Oct 7, 2026 — 6:00 PM to 10:00 PM IST`);
  console.log(`  Duration: 120 minutes`);
  console.log(`  Batches: ${BATCHES.join(", ")}`);
  console.log(`  Integrity: require_fullscreen=true, block_external_paste=true, require_seb=true`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
