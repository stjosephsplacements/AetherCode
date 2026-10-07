/**
 * HOPE Day 3 — Level 1: Frequency & Reorganization
 * Oct 7, 2026 | 6:00 PM – 10:00 PM IST | 120 minutes
 * 5 questions × 20 test cases (2 sample + 18 hidden)
 * Languages: c, cpp, python, java
 * Batches: 2Y-B2, 2Y-B3, 2Y-B4, 3Y-B6, 3Y-B7, 3Y-B8, SEB-TEST
 */

import { sql } from "../lib/db.ts";

const ADMIN_ID = "2cabecf4-74f4-461c-b596-d0fee3fb88b5";

const BATCHES = [
  "2Y-HOPE-B2",
  "2Y-HOPE-B3",
  "2Y-HOPE-B4",
  "3Y-HOPE-B6",
  "3Y-HOPE-B7",
  "3Y-HOPE-B8",
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

  // ── Q1: Top K Frequent Elements ─────────────────────────────────────────
  {
    title: "Top K Frequent Elements",
    statement: `You are given an array of $N$ integers and an integer $K$. Return the $K$ **most frequent** elements.

Output them sorted by **frequency in descending order**. If two elements have the same frequency, output the **smaller value first**.

---

**Input Format**

- First line: two integers $N$ and $K$ $(1 \\le K \\le \\text{number of distinct elements} \\le N \\le 10^5)$
- Second line: $N$ space-separated integers $(-10^4 \\le a_i \\le 10^4)$

**Output Format**

Print $K$ space-separated integers — the $K$ most frequent elements, sorted by frequency descending (ties broken by smaller value first).

---

**Sample Input 1**
\`\`\`
6 2
1 1 1 2 2 3
\`\`\`
**Sample Output 1**
\`\`\`
1 2
\`\`\`
**Explanation:** $1$ appears $3$ times, $2$ appears $2$ times, $3$ appears $1$ time. Top $2$: $1$ and $2$.

---

**Sample Input 2**
\`\`\`
1 1
1
\`\`\`
**Sample Output 2**
\`\`\`
1
\`\`\`

---

**Constraints**
- $1 \\le K \\le \\text{distinct count} \\le N \\le 10^5$
- $-10^4 \\le a_i \\le 10^4$

**Hint:** Count frequencies using a hash map. Then sort the entries by frequency descending, breaking ties by value ascending. Return the first $K$ elements.`,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["6 2\n1 1 1 2 2 3", "1 2"],
        ["1 1\n1", "1"],
      ],
      [
        // All same element
        ["5 1\n4 4 4 4 4", "4"],
        // Each element unique, K = all
        ["4 4\n3 1 4 2", "1 2 3 4"],
        // Tie-breaking by value
        ["6 2\n1 2 3 1 2 3", "1 2"],
        // K = 1, single max
        ["7 1\n5 5 5 3 3 1 1", "5"],
        // K = number of distinct
        ["6 3\n1 1 2 2 3 3", "1 2 3"],
        // Negative numbers
        ["6 2\n-1 -1 -2 -2 -2 3", "-2 -1"],
        // Mixed negative and positive
        ["8 3\n-1 -1 -1 0 0 1 1 1", "-1 1 0"],
        // Single element repeated
        ["3 1\n7 7 7", "7"],
        // Two distinct, K=1
        ["5 1\n1 2 1 2 1", "1"],
        // Large K
        ["10 5\n1 1 2 2 3 3 4 4 5 5", "1 2 3 4 5"],
        // Descending frequency order
        ["10 3\n1 1 1 1 2 2 2 3 3 4", "1 2 3"],
        // K = 1, tie between two — pick smaller
        ["4 1\n5 5 3 3", "3"],
        // Zero in the mix
        ["5 2\n0 0 0 1 1", "0 1"],
        // All negative
        ["6 2\n-5 -5 -5 -3 -3 -1", "-5 -3"],
        // Frequency 1 each, sorted by value
        ["5 3\n10 20 30 40 50", "10 20 30"],
        // Three-way tie
        ["9 3\n1 1 1 2 2 2 3 3 3", "1 2 3"],
        // Large spread
        ["8 2\n-10000 -10000 10000 10000 10000 0 0 0", "0 10000"],
      ]
    ),
  },

  // ── Q2: Frequency Sort ──────────────────────────────────────────────────
  {
    title: "Frequency Sort",
    statement: `Given an array of $N$ integers, sort the array based on the **frequency** of each element in **descending order** (most frequent first). If two elements have the **same frequency**, the **smaller element** comes first.

When printing, each element appears as many times as it occurs in the original array.

---

**Input Format**

- First line: an integer $N$ $(1 \\le N \\le 10^5)$
- Second line: $N$ space-separated integers $(-10^4 \\le a_i \\le 10^4)$

**Output Format**

Print $N$ space-separated integers — the array sorted by frequency (descending), with ties broken by value (ascending).

---

**Sample Input 1**
\`\`\`
6
1 1 2 2 2 3
\`\`\`
**Sample Output 1**
\`\`\`
2 2 2 1 1 3
\`\`\`
**Explanation:** $2$ appears $3$ times, $1$ appears $2$ times, $3$ appears $1$ time. Sorted by frequency: $[2,2,2,1,1,3]$.

---

**Sample Input 2**
\`\`\`
4
4 4 3 3
\`\`\`
**Sample Output 2**
\`\`\`
3 3 4 4
\`\`\`
**Explanation:** Both have frequency $2$; smaller value ($3$) comes first.

---

**Constraints**
- $1 \\le N \\le 10^5$
- $-10^4 \\le a_i \\le 10^4$

**Hint:** Count frequencies. Then sort by \`(-frequency, value)\` as the key. Expand each element by its count.`,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["6\n1 1 2 2 2 3", "2 2 2 1 1 3"],
        ["4\n4 4 3 3", "3 3 4 4"],
      ],
      [
        // Single element
        ["1\n5", "5"],
        // All same
        ["4\n7 7 7 7", "7 7 7 7"],
        // Already frequency sorted
        ["5\n1 1 1 2 2", "1 1 1 2 2"],
        // Three distinct freq 1,2,3
        ["6\n3 2 2 1 1 1", "1 1 1 2 2 3"],
        // All unique — ascending order
        ["5\n5 3 1 4 2", "1 2 3 4 5"],
        // Two groups, tie
        ["6\n10 20 10 20 10 20", "10 10 10 20 20 20"],
        // Negative values
        ["5\n-1 -1 -2 -2 -2", "-2 -2 -2 -1 -1"],
        // Mixed negative positive
        ["6\n-1 -1 -1 2 2 3", "-1 -1 -1 2 2 3"],
        // Zero
        ["4\n0 0 1 1", "0 0 1 1"],
        // Three-way tie
        ["6\n3 1 2 3 1 2", "1 1 2 2 3 3"],
        // One dominant
        ["7\n5 5 5 5 1 2 3", "5 5 5 5 1 2 3"],
        // Two elements, one much more frequent
        ["6\n9 9 9 9 1 1", "9 9 9 9 1 1"],
        // Large negative
        ["4\n-10000 -10000 10000 10000", "-10000 -10000 10000 10000"],
        // Single occurrence each
        ["3\n100 50 75", "50 75 100"],
        // Pair and singles
        ["5\n2 3 2 1 4", "2 2 1 3 4"],
        // Freq 3, 2, 1, 1
        ["7\n1 1 1 2 2 3 4", "1 1 1 2 2 3 4"],
        // Scrambled input — freq: 2=3, 3=3, 1=2
        ["8\n3 1 3 1 3 2 2 2", "2 2 2 3 3 3 1 1"],
      ]
    ),
  },

  // ── Q3: Unique Frequency Check ──────────────────────────────────────────
  {
    title: "Unique Frequency Check",
    statement: `Given an array of $N$ integers, determine whether all elements have **unique occurrence counts**.

In other words, no two distinct values should appear the same number of times.

---

**Input Format**

- First line: an integer $N$ $(1 \\le N \\le 10^5)$
- Second line: $N$ space-separated integers $(-10^3 \\le a_i \\le 10^3)$

**Output Format**

Print \`YES\` if all occurrence counts are unique, \`NO\` otherwise.

---

**Sample Input 1**
\`\`\`
6
1 2 2 3 3 3
\`\`\`
**Sample Output 1**
\`\`\`
YES
\`\`\`
**Explanation:** $1$ appears $1$ time, $2$ appears $2$ times, $3$ appears $3$ times. Frequencies $\\{1, 2, 3\\}$ — all unique.

---

**Sample Input 2**
\`\`\`
4
1 2 3 4
\`\`\`
**Sample Output 2**
\`\`\`
NO
\`\`\`
**Explanation:** All appear $1$ time. Frequency set $\\{1, 1, 1, 1\\}$ — not unique.

---

**Constraints**
- $1 \\le N \\le 10^5$
- $-10^3 \\le a_i \\le 10^3$

**Hint:** Count occurrences using a hash map. Collect all counts into a set. If the set size equals the number of distinct elements, answer is YES.`,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["6\n1 2 2 3 3 3", "YES"],
        ["4\n1 2 3 4", "NO"],
      ],
      [
        // Single element
        ["1\n5", "YES"],
        // Two same elements
        ["2\n1 1", "YES"],
        // Two different, same freq
        ["4\n1 1 2 2", "NO"],
        // Two different, diff freq
        ["3\n1 2 2", "YES"],
        // All same — one distinct element, one unique freq
        ["5\n3 3 3 3 3", "YES"],
        // Three distinct, freqs 1,2,3
        ["6\n1 2 2 3 3 3", "YES"],
        // Three distinct, freqs 2,2,1 → NO
        ["5\n1 1 2 2 3", "NO"],
        // Negative values, unique freqs
        ["6\n-1 -2 -2 -3 -3 -3", "YES"],
        // Negative values, duplicate freqs
        ["4\n-1 -1 -2 -2", "NO"],
        // Mixed neg/pos, unique
        ["10\n-1 0 0 1 1 1 2 2 2 2", "YES"],
        // Mixed neg/pos, not unique
        ["6\n-1 -1 0 0 1 1", "NO"],
        // Large unique chain: 1+2+3+4=10
        ["10\n1 2 2 3 3 3 4 4 4 4", "YES"],
        // Large non-unique
        ["8\n1 1 2 2 3 3 4 4", "NO"],
        // Five distinct, freqs 1,2,3,4,5
        ["15\n1 2 2 3 3 3 4 4 4 4 5 5 5 5 5", "YES"],
        // Two elements, freq 1 and 2
        ["3\n10 20 20", "YES"],
        // Zero included
        ["7\n0 0 0 1 1 2 2", "NO"],
        // Zero with unique freqs
        ["6\n0 0 0 1 1 2", "YES"],
      ]
    ),
  },

  // ── Q4: Reorganize String ───────────────────────────────────────────────
  {
    title: "Reorganize String",
    statement: `Given a string $S$ consisting of lowercase English letters, rearrange the characters so that **no two adjacent characters are the same**.

If it is impossible, print \`IMPOSSIBLE\`.

If it is possible, print a valid rearrangement. Use the following **deterministic rule** to produce a unique answer: at each step, among all characters that still have remaining count and differ from the last character placed, pick the one with the **highest remaining count**; break ties by choosing the **alphabetically smaller** character.

---

**Input Format**

- A single line containing a string $S$ $(1 \\le |S| \\le 10^5)$ of lowercase English letters.

**Output Format**

Print the rearranged string, or \`IMPOSSIBLE\` if no valid arrangement exists.

---

**Sample Input 1**
\`\`\`
aab
\`\`\`
**Sample Output 1**
\`\`\`
aba
\`\`\`
**Explanation:** $a$ has count $2$, $b$ has count $1$. Step 1: pick $a$ (highest). Step 2: pick $b$ (only option different from $a$). Step 3: pick $a$. Result: \`aba\`.

---

**Sample Input 2**
\`\`\`
aaab
\`\`\`
**Sample Output 2**
\`\`\`
IMPOSSIBLE
\`\`\`
**Explanation:** $a$ appears $3$ times in a string of length $4$. Since $3 > \\lceil 4/2 \\rceil = 2$, no valid arrangement exists.

---

**Constraints**
- $1 \\le |S| \\le 10^5$
- $S$ consists of lowercase English letters only

**Condition for impossibility:** If any character's count exceeds $\\lceil |S| / 2 \\rceil$, it is impossible.

**Hint:** Use a max-heap (priority queue) of \`(count, char)\`. Pop the character with the highest count (ties: alphabetically smaller). If it equals the last placed character, pop the next one instead and push the first back. Place the chosen character, decrement its count, and push it back if count $> 0$.`,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["aab", "aba"],
        ["aaab", "IMPOSSIBLE"],
      ],
      [
        // Single char
        ["a", "a"],
        // Two same chars
        ["aa", "IMPOSSIBLE"],
        // Two different chars
        ["ab", "ab"],
        // Three same
        ["aaa", "IMPOSSIBLE"],
        // Balanced two chars
        ["aabb", "abab"],
        // Three chars balanced
        ["abc", "abc"],
        // One dominant just at limit (len=5, ceil=3, a=3)
        ["aaabc", "abaca"],
        // One dominant over limit
        ["aaaab", "IMPOSSIBLE"],
        // All same char long
        ["aaaaa", "IMPOSSIBLE"],
        // Even split two chars
        ["aaabbb", "ababab"],
        // Odd split — a=3, b=2 (len=5, ceil=3, ok)
        ["aaabb", "ababa"],
        // Three chars, one dominant
        ["aaabc", "abaca"],
        // abcabc
        ["aabbcc", "abacbc"],
        // Single char repeated twice
        ["bb", "IMPOSSIBLE"],
        // Large balanced — a=2 b=2 c=1
        ["aabbc", "ababc"],
        // Four distinct one each
        ["abcd", "abcd"],
        // a=4, b=3, c=2 (len=9, ceil=5, ok)
        ["aaaabbbcc", "abababcac"],
        // a=5 in len=9 — 5 == ceil(9/2)=5, OK
        ["aaaaabbbb", "ababababa"],
      ]
    ),
  },

  // ── Q5: Task Scheduler ──────────────────────────────────────────────────
  {
    title: "Task Scheduler",
    statement: `You are given $N$ tasks represented by uppercase English letters, and a **cooldown period** $n$. The same task must be separated by at least $n$ intervals. During a cooldown gap the CPU can execute a different task or remain **idle**.

Find the **minimum number of intervals** the CPU needs to finish all tasks.

---

**Input Format**

- First line: an integer $N$ — the number of tasks $(1 \\le N \\le 10^4)$
- Second line: $N$ space-separated uppercase letters
- Third line: an integer $n$ — the cooldown period $(0 \\le n \\le 100)$

**Output Format**

Print a single integer — the minimum number of intervals.

---

**Sample Input 1**
\`\`\`
6
A A A B B B
3
\`\`\`
**Sample Output 1**
\`\`\`
10
\`\`\`
**Explanation:** One optimal schedule: \`A B _ _ A B _ _ A B\`. The cooldown of $3$ between identical tasks forces $2$ idle slots in each gap. Total = $10$.

---

**Sample Input 2**
\`\`\`
6
A A A B B B
0
\`\`\`
**Sample Output 2**
\`\`\`
6
\`\`\`
**Explanation:** With cooldown $0$ there is no restriction. Execute all $6$ tasks back to back.

---

**Constraints**
- $1 \\le N \\le 10^4$
- Tasks are uppercase letters \`A\`–\`Z\`
- $0 \\le n \\le 100$

**Hint:** Let $f_{\\max}$ be the highest task frequency and $c$ be the count of tasks that share that maximum frequency. The answer is:

$$\\max\\bigl(N,\\;(f_{\\max} - 1) \\times (n + 1) + c\\bigr)$$

The first term handles the case where tasks fill all slots; the second accounts for the cooldown gaps.`,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["6\nA A A B B B\n3", "10"],
        ["6\nA A A B B B\n0", "6"],
      ],
      [
        // Single task, no cooldown
        ["1\nA\n0", "1"],
        // Single task, large cooldown
        ["1\nA\n100", "1"],
        // Two same tasks, cooldown 1
        ["2\nA A\n1", "3"],
        // Two same tasks, cooldown 2
        ["2\nA A\n2", "4"],
        // Two different tasks, cooldown 1
        ["2\nA B\n1", "2"],
        // All same task
        ["4\nA A A A\n2", "10"],
        // All different, cooldown 0
        ["4\nA B C D\n0", "4"],
        // All different, large cooldown
        ["4\nA B C D\n10", "4"],
        // Three tasks, two with max freq
        ["5\nA A B B C\n2", "5"],
        // n = 0, many tasks
        ["8\nA A A B B B C C\n0", "8"],
        // Large cooldown, single repeated
        ["3\nA A A\n5", "13"],
        // Tasks fill the gaps perfectly
        ["9\nA A A B B B C C C\n2", "9"],
        // More tasks than formula slots
        ["12\nA A A B B B C C C D D D\n2", "12"],
        // One dominant with many fillers
        ["7\nA A A A B C D\n2", "10"],
        // Two with max, cooldown 1
        ["6\nA A A B B B\n1", "6"],
        // Five As, cooldown 3
        ["5\nA A A A A\n3", "17"],
        // Cooldown exactly causes one idle
        ["5\nA A A B B\n2", "7"],
      ]
    ),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Creating HOPE Day 3 — Level 1: Frequency & Reorganization...\n");

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

- This is a **2-hour timed assessment**. Your timer starts the moment you open the exam.
- You may use **C, C++, Python, or Java**.
- Each problem has **2 visible sample test cases** to help you verify your approach, and **18 hidden test cases** used for grading.
- Questions cover **Frequency Counting** and **String/Array Reorganization** patterns.
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
      'HOPE Day 3 — Level 1: Frequency & Reorganization',
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

  console.log(`\n✓ HOPE Day 3 — Level 1: Frequency & Reorganization ready`);
  console.log(`  Exam ID: ${examId}`);
  console.log(`  Questions: ${questionIds.length}`);
  console.log(`  Window: Oct 7, 2026 — 6:00 PM to 10:00 PM IST`);
  console.log(`  Duration: 120 minutes`);
  console.log(`  Batches: ${BATCHES.join(", ")}`);
  console.log(`  Integrity: fullscreen=ON, paste-block=ON, SEB=ON`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
