/**
 * HOPE Assessment — Level 1: Greedy Arrays & Strings
 * Oct 6, 2026 | 6:00 PM – 10:00 PM IST | 120 minutes
 * 5 questions × 20 test cases (2 sample + 18 hidden)
 * Languages: c, cpp, python, java
 * Mapped to all 13 HOPE batches
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

// ─────────────────────────────────────────────────────────────────────────────
const QUESTIONS: Question[] = [

  // ── Q1: Can You Reach the End? ───────────────────────────────────────────
  {
    title: "Can You Reach the End?",
    statement: `You are standing at position $0$ of a row of $N$ stones numbered $0$ to $N-1$.

Each stone $i$ has a value $a[i]$ which tells you the **maximum number of steps forward** you can leap from that stone. For example, if $a[i] = 3$, you can jump to stone $i+1$, $i+2$, or $i+3$ — your choice.

Your goal is to determine whether it is possible to reach the **last stone** (index $N-1$) starting from stone $0$.

**Note:** A stone with value $0$ means you are stuck there and cannot move forward.

---

**Input Format**

- First line: a single integer $N$ — the number of stones $(1 \\le N \\le 10^5)$
- Second line: $N$ space-separated integers — the jump values $a[0], a[1], \\ldots, a[N-1]$, where $0 \\le a[i] \\le 10^5$

**Output Format**

Print \`YES\` if you can reach the last stone, or \`NO\` if it is impossible.

---

**Sample Input 1**
\`\`\`
6
2 3 1 1 4 0
\`\`\`
**Sample Output 1**
\`\`\`
YES
\`\`\`
**Explanation:** One valid path is $0 \\to 1 \\to 4 \\to 5$ (jump 1 step, then jump 3 steps, then jump 1 step). You successfully land on the last stone.

---

**Sample Input 2**
\`\`\`
5
3 2 1 0 4
\`\`\`
**Sample Output 2**
\`\`\`
NO
\`\`\`
**Explanation:** From index $0$ you can reach indices $1$, $2$, $3$. However, $a[3] = 0$ and $a[2] = 1$ only reaches $3$, and $a[1] = 2$ also only reaches $2$ or $3$. There is no way to get past index $3$ because every path leads to the zero stone.

---

**Constraints**
- $1 \\le N \\le 10^5$
- $0 \\le a[i] \\le 10^5$

**Hint:** Think about tracking the farthest index you can ever reach as you sweep through the array.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["6\n2 3 1 1 4 0", "YES"],
        ["5\n3 2 1 0 4", "NO"],
      ],
      [
        // Edge: single stone — already at destination
        ["1\n0", "YES"],
        // Edge: two stones, first has jump=0
        ["2\n0 1", "NO"],
        // Edge: two stones, first has jump=1
        ["2\n1 0", "YES"],
        // All zeros except first large jump
        ["6\n5 0 0 0 0 0", "YES"],
        // All zeros — stuck immediately
        ["5\n0 0 0 0 0", "NO"],
        // Each stone can only reach next — works
        ["5\n1 1 1 1 0", "YES"],
        // Zero in the middle blocks path
        ["7\n4 0 0 0 3 0 0", "YES"],
        // Zero just before last stone
        ["5\n2 2 2 0 1", "YES"],
        // Large jump from index 0 clears everything
        ["10\n10 0 0 0 0 0 0 0 0 0", "YES"],
        // Barely can't reach — zero wall
        ["6\n1 2 0 0 1 0", "NO"],
        // Zero at last index — still counts as YES since we land on it
        ["4\n3 2 1 0", "YES"],
        // Multiple zeros, but a long early jump clears them
        ["8\n7 0 0 0 0 0 0 0", "YES"],
        // Alternating 1 and 0 — 1s keep you moving
        ["7\n1 0 1 0 1 0 1", "YES"],
        // Stuck at index 1
        ["5\n1 0 2 0 1", "NO"],
        // Long reach, reachable
        ["8\n2 3 0 1 4 0 0 0", "YES"],
        // Zero blocker between accessible zones
        ["6\n1 2 0 0 0 1", "NO"],
        // Single stone with value 1 — last is index 0 = YES
        ["1\n1", "YES"],
      ]
    ),
  },

  // ── Q2: Minimum Leaps ────────────────────────────────────────────────────
  {
    title: "Minimum Leaps",
    statement: `You are again at stone $0$ in a row of $N$ stones and want to reach stone $N-1$.

Each stone $i$ has a value $a[i]$: the **maximum number of steps** you can jump forward from it. It is **guaranteed** that the last stone is always reachable from stone $0$.

Find the **minimum number of jumps** needed to reach the last stone.

---

**Input Format**

- First line: a single integer $N$ $(1 \\le N \\le 10^4)$
- Second line: $N$ space-separated non-negative integers where $1 \\le a[i] \\le 10^5$ for all $i < N-1$, and $a[N-1]$ can be any non-negative integer

**Output Format**

Print a single integer — the minimum number of jumps to reach stone $N-1$.

---

**Sample Input 1**
\`\`\`
6
2 3 1 1 4 0
\`\`\`
**Sample Output 1**
\`\`\`
2
\`\`\`
**Explanation:** The optimal path is $0 \\xrightarrow{+2} 2 \\xrightarrow{+3} 5$. From index $0$, jump $2$ steps to reach index $2$. From there $a[2]=1$ but wait — actually $0 \\xrightarrow{+1} 1 \\xrightarrow{+3} 4 \\xrightarrow{+1} 5$ needs 3 jumps. Instead: $0 \\xrightarrow{+1} 1$ then $1 \\xrightarrow{+4} 5$ — that's only 2 jumps!

---

**Sample Input 2**
\`\`\`
4
1 1 1 1
\`\`\`
**Sample Output 2**
\`\`\`
3
\`\`\`
**Explanation:** Each stone only lets you jump exactly one step, so you must visit every stone: $0 \\to 1 \\to 2 \\to 3$.

---

**Constraints**
- $1 \\le N \\le 10^4$
- The last stone is always reachable
- $1 \\le a[i] \\le 10^5$ for all $i < N-1$

**Hint:** At each "level" of jumps, greedily extend as far as possible before committing to a new jump.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["6\n2 3 1 1 4 0", "2"],
        ["4\n1 1 1 1", "3"],
      ],
      [
        // Single stone — 0 jumps needed
        ["1\n0", "0"],
        // Two stones — 1 jump
        ["2\n1 0", "1"],
        // Huge jump from index 0
        ["5\n4 1 1 1 0", "1"],
        // Each step exactly 1
        ["6\n1 1 1 1 1 0", "5"],
        // Jump 2 at a time
        ["7\n2 2 2 2 2 2 0", "3"],
        // Greedy extends far on first step
        ["5\n3 1 1 1 0", "2"],
        // All max jumps
        ["5\n5 5 5 5 0", "1"],
        // Classic BFS-levels test
        ["8\n1 3 5 1 1 1 1 0", "3"],
        // Long array, all 1s
        ["10\n1 1 1 1 1 1 1 1 1 0", "9"],
        // Jump pattern 2-1-2-1
        ["6\n2 1 2 1 2 0", "3"],
        // One big jump then done
        ["9\n8 1 1 1 1 1 1 1 0", "1"],
        // Alternating large/small
        ["7\n1 5 1 5 1 5 0", "2"],
        // Must take all steps
        ["5\n1 2 1 1 0", "3"],
        // Near-optimal greedy
        ["6\n3 2 1 3 1 0", "2"],
        // Two jumps of size 3
        ["7\n3 1 1 3 1 1 0", "2"],
        // Jump 1, then big
        ["6\n1 4 1 1 1 0", "2"],
        // Descending array
        ["6\n5 4 3 2 1 0", "1"],
        // Requires 4 jumps
        ["8\n1 1 1 1 1 1 1 0", "7"],
      ]
    ),
  },

  // ── Q3: Circular Fuel Route ──────────────────────────────────────────────
  {
    title: "Circular Fuel Route",
    statement: `There are $N$ fuel stations arranged in a **circle**, numbered $0$ to $N-1$. At station $i$, you can collect $\\text{fuel}[i]$ litres of petrol. Travelling from station $i$ to the next station $i+1$ (wrapping from $N-1$ back to $0$) costs $\\text{cost}[i]$ litres.

You have a vehicle that starts with an **empty tank** (unlimited capacity). You may start your journey at any station.

Find the **index of the starting station** from which you can complete a full circle (visiting every station in order and returning to where you started) without running out of fuel at any point.

If no such starting station exists, print $-1$.

**It is guaranteed that if a solution exists, it is unique.**

---

**Input Format**

- First line: a single integer $N$ — the number of stations $(1 \\le N \\le 10^5)$
- Second line: $N$ space-separated integers — $\\text{fuel}[0], \\text{fuel}[1], \\ldots, \\text{fuel}[N-1]$, where $0 \\le \\text{fuel}[i] \\le 10^4$
- Third line: $N$ space-separated integers — $\\text{cost}[0], \\text{cost}[1], \\ldots, \\text{cost}[N-1]$, where $0 \\le \\text{cost}[i] \\le 10^4$

**Output Format**

Print a single integer — the 0-based index of the valid starting station, or $-1$ if it is impossible.

---

**Sample Input 1**
\`\`\`
5
1 2 3 4 5
3 4 5 1 2
\`\`\`
**Sample Output 1**
\`\`\`
3
\`\`\`
**Explanation:**
Starting at station $3$:
- At $3$: collect $4$, spend $1$ to reach $4$ → tank = $3$
- At $4$: collect $5$, spend $2$ to reach $0$ → tank = $6$
- At $0$: collect $1$, spend $3$ to reach $1$ → tank = $4$
- At $1$: collect $2$, spend $4$ to reach $2$ → tank = $2$
- At $2$: collect $3$, spend $5$ to reach $3$ → tank = $0$

Tank never goes negative — circuit completed!

---

**Sample Input 2**
\`\`\`
3
2 3 4
3 4 3
\`\`\`
**Sample Output 2**
\`\`\`
-1
\`\`\`
**Explanation:** Total fuel = $9$, total cost = $10$. Since cost exceeds fuel overall, no starting point works.

---

**Constraints**
- $1 \\le N \\le 10^5$
- $0 \\le \\text{fuel}[i],\\ \\text{cost}[i] \\le 10^4$

**Key Insight:** If the total fuel is less than the total cost, the answer is always $-1$. Otherwise, exactly one valid starting station always exists.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["5\n1 2 3 4 5\n3 4 5 1 2", "3"],
        ["3\n2 3 4\n3 4 3", "-1"],
      ],
      [
        // N=1, fuel >= cost
        ["1\n5\n3", "0"],
        // N=1, fuel < cost
        ["1\n2\n5", "-1"],
        // Answer at index 0
        ["3\n5 1 1\n1 2 3", "0"],
        // Answer at last index
        ["4\n1 1 1 5\n2 2 2 1", "3"],
        // Exact balance — answer at 0
        ["3\n3 3 3\n3 3 3", "0"],
        // Just enough fuel total
        ["4\n2 3 1 4\n3 2 2 3", "3"],
        // All stations surplus except one
        ["5\n4 4 4 4 1\n3 3 3 3 5", "0"],
        // Large N, answer in the middle
        ["6\n1 1 1 10 1 1\n2 2 2 1 2 2", "3"],
        // Barely impossible
        ["4\n3 3 3 3\n4 3 3 3", "-1"],
        // All equal fuel and cost
        ["5\n2 2 2 2 2\n2 2 2 2 2", "0"],
        // Surplus only at last station
        ["5\n0 0 0 0 10\n2 2 2 2 1", "4"],
        // Only one valid station (classic)
        ["4\n4 1 2 3\n3 3 3 1", "0"],
        // Large single surplus
        ["6\n1 1 1 1 1 100\n10 10 10 10 10 1", "5"],
        // Deficit at start, surplus later
        ["3\n1 5 2\n3 2 2", "1"],
        // Surplus front-loaded
        ["5\n10 1 1 1 1\n2 3 2 3 3", "0"],
        // Answer requires wrapping around
        ["4\n2 2 10 2\n5 5 2 1", "2"],
        // N=2, feasible
        ["2\n3 1\n1 2", "0"],
        // N=2, infeasible
        ["2\n1 1\n2 1", "-1"],
      ]
    ),
  },

  // ── Q4: Balanced Segmentation ───────────────────────────────────────────
  {
    title: "Balanced Segmentation",
    statement: `You are given a string $S$ consisting of **lowercase English letters**.

Your task is to **partition** $S$ into the **maximum number of contiguous parts** (substrings) such that every letter of the alphabet appears in **at most one part**. In other words, if a letter appears in part $i$, it must not appear in any other part.

Return the **lengths** of the parts in left-to-right order.

---

**Input Format**

A single line containing the string $S$ $(1 \\le |S| \\le 1000)$, made of lowercase English letters only.

**Output Format**

Print the lengths of all parts, separated by spaces, in the order they appear in $S$.

---

**Sample Input 1**
\`\`\`
ababcbacadefegdehijhklij
\`\`\`
**Sample Output 1**
\`\`\`
9 7 8
\`\`\`
**Explanation:**
- Part 1: \`ababcbaca\` (length 9) — contains letters a, b, c. The last occurrence of 'a' is at index 8, 'b' at index 5, 'c' at index 7 — so this part must extend to index 8.
- Part 2: \`defegde\` (length 7) — contains d, e, f, g. Last 'd' is at index 15, last 'e' at index 15 — this part ends at index 15.
- Part 3: \`hijhklij\` (length 8) — contains h, i, j, k, l.

No letter appears in more than one part.

---

**Sample Input 2**
\`\`\`
eccbbbbdec
\`\`\`
**Sample Output 2**
\`\`\`
10
\`\`\`
**Explanation:** The letters 'e', 'c' both appear at the beginning and end of the string, so the entire string must be a single part.

---

**Constraints**
- $1 \\le |S| \\le 1000$
- $S$ contains only lowercase English letters ('a'–'z')

**Hint:** For each character, record the **last index** at which it appears. Then sweep through the string, extending the current segment's end whenever you encounter a character whose last occurrence is beyond the current end.`,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["ababcbacadefegdehijhklij", "9 7 8"],
        ["eccbbbbdec", "10"],
      ],
      [
        // Single character
        ["a", "1"],
        // All unique characters
        ["abcde", "1 1 1 1 1"],
        // All same character
        ["aaaaa", "5"],
        // Two groups: ab | cd
        ["aabbccdd", "4 4"],
        // Interleaved: must merge
        ["abab", "4"],
        // Three clean segments
        ["aabbccxxyyzz", "6 6"],
        // Last char repeats early — forces merge
        ["abca", "4"],
        // Classic two-split
        ["caedbdedda", "1 9"],
        // Letter at very start and very end
        ["abcdefghija", "11"],
        // Alternating same two letters
        ["xyxyxyxy", "8"],
        // Three segments of different lengths
        ["aaabbbccc", "3 3 3"],
        // Single pair repeated
        ["ababab", "6"],
        // Letters that don't overlap
        ["aabbccdd", "4 4"],
        // One segment per letter
        ["abcdefghijklmnopqrstuvwxyz", "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1"],
        // Letter z forces full merge
        ["abcdefghijklmnopqrstuvwxyza", "27"],
        // Two interlocked groups
        ["azcbzc", "6"],
        // Clean split at middle
        ["aaaabbbb", "4 4"],
        // All in one — every letter touches another
        ["abcabc", "6"],
      ]
    ),
  },

  // ── Q5: Peak Contiguous Sum ──────────────────────────────────────────────
  {
    title: "Peak Contiguous Sum",
    statement: `Given an array of $N$ integers (which may include negative numbers), find the **maximum possible sum** of any **contiguous subarray** (subarray must contain at least one element).

This is a classic problem in algorithm design — the key challenge is handling arrays where all elements are negative.

---

**Input Format**

- First line: a single integer $N$ — the length of the array $(1 \\le N \\le 10^5)$
- Second line: $N$ space-separated integers $a[0], a[1], \\ldots, a[N-1]$, where $-10^4 \\le a[i] \\le 10^4$

**Output Format**

Print a single integer — the maximum subarray sum.

---

**Sample Input 1**
\`\`\`
9
-2 1 -3 4 -1 2 1 -5 4
\`\`\`
**Sample Output 1**
\`\`\`
6
\`\`\`
**Explanation:** The subarray $[4, -1, 2, 1]$ (indices 3 to 6) has sum $4 + (-1) + 2 + 1 = 6$, which is the maximum achievable.

---

**Sample Input 2**
\`\`\`
4
-3 -1 -4 -2
\`\`\`
**Sample Output 2**
\`\`\`
-1
\`\`\`
**Explanation:** All elements are negative. The best we can do is pick the largest single element, which is $-1$.

---

**Constraints**
- $1 \\le N \\le 10^5$
- $-10^4 \\le a[i] \\le 10^4$
- The subarray must be **contiguous** and contain **at least one element**

**Hint:** Use Kadane's algorithm: maintain a running sum and reset it to $0$ whenever it drops below $0$, keeping track of the maximum seen.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["9\n-2 1 -3 4 -1 2 1 -5 4", "6"],
        ["4\n-3 -1 -4 -2", "-1"],
      ],
      [
        // All positive — entire array
        ["5\n1 2 3 4 5", "15"],
        // All positive, single element
        ["1\n7", "7"],
        // All negative, single element
        ["1\n-7", "-7"],
        // Single zero
        ["1\n0", "0"],
        // All same negative
        ["5\n-2 -2 -2 -2 -2", "-2"],
        // All same positive
        ["5\n3 3 3 3 3", "15"],
        // Large positive flanked by negatives
        ["5\n-100 -100 500 -100 -100", "500"],
        // Alternating pos/neg, pos wins
        ["6\n3 -2 3 -2 3 -2", "7"],
        // Start is best
        ["5\n10 -11 1 1 1", "10"],
        // End is best
        ["5\n1 1 1 -11 10", "10"],
        // Middle segment
        ["7\n-5 3 4 -1 3 -10 2", "9"],
        // Entire array sums to max
        ["6\n1 2 3 4 5 6", "21"],
        // Classic: mix of gains and drains
        ["8\n5 -3 5 -2 3 -10 4 2", "10"],
        // Large negatives with one outlier
        ["5\n-1000 -1000 5000 -1000 -1000", "5000"],
        // Wrap around not valid — test that it isn't taken
        ["5\n-2 -3 4 -1 -2", "4"],
        // Maximum possible with constraint values
        ["5\n10000 10000 10000 10000 10000", "50000"],
        // Minimum value scenario
        ["3\n-10000 -10000 -10000", "-10000"],
        // Two equal candidates
        ["7\n3 -4 3 3 -4 3 -4", "6"],
      ]
    ),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Creating HOPE Assessment — Level 1...\n");

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

  // Create the exam
  const [{ id: examId }] = await sql<[{ id: string }]>`
    INSERT INTO exams (
      title, instructions, starts_at, ends_at, duration_minutes,
      languages, batches, published, created_by
    ) VALUES (
      'HOPE Assessment — Level 1',
      ${'## Instructions\n\n- This is a **2-hour** timed assessment. Your timer starts the moment you open the exam.\n- You may use **C, C++, Python, or Java**.\n- Each problem has **2 visible sample test cases** to help you verify your approach, and **18 hidden test cases** used for grading.\n- Read each problem statement carefully, paying attention to constraints and edge cases.\n- Partial credit is awarded per test case — a correct solution that passes all 20 cases earns full marks.\n- Do **not** refresh the page or navigate away once you start.\n- Good luck!'},
      '2026-10-06 18:00:00+05:30',
      '2026-10-06 22:00:00+05:30',
      120,
      ARRAY['c','cpp','python','java'],
      ${HOPE_BATCHES}::text[],
      true,
      ${ADMIN_ID}
    )
    RETURNING id
  `;

  console.log(`\n  Exam created: "${examId}"`);

  // Link questions to exam
  for (let i = 0; i < questionIds.length; i++) {
    await sql`
      INSERT INTO exam_questions (exam_id, question_id, ord, points, slot)
      VALUES (${examId}, ${questionIds[i]}, ${i + 1}, 100, ${i + 1})
    `;
  }

  console.log(`\n✓ HOPE Assessment — Level 1 ready`);
  console.log(`  Exam ID: ${examId}`);
  console.log(`  Questions: ${questionIds.length}`);
  console.log(`  Window: Oct 6, 2026 — 6:00 PM to 10:00 PM IST`);
  console.log(`  Duration: 120 minutes`);
  console.log(`  Batches: ${HOPE_BATCHES.join(", ")}`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
