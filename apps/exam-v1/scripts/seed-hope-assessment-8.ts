/**
 * HOPE Day 3 — Praveen's Batch: Advanced Algorithms
 * Oct 7, 2026 | 6:00 PM – 10:00 PM IST | 120 minutes
 * 5 questions × 20 test cases (2 sample + 18 hidden)
 * Languages: c, cpp, python, java
 * Mapped to: 3Y-HOPE-B1, SEB-TEST
 */

import { sql } from "../lib/db.ts";

const ADMIN_ID = "2cabecf4-74f4-461c-b596-d0fee3fb88b5";

const BATCHES = [
  "3Y-HOPE-B1",
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

  // ── Q1: Pattern Matching (KMP) ─────────────────────────────────────────────
  {
    title: "Pattern Matching (KMP)",
    statement: `You are given a text string $T$ and a pattern string $P$. Find **all** starting positions (0-indexed) where $P$ occurs as a substring in $T$.

Use the **KMP (Knuth-Morris-Pratt)** algorithm for an efficient $O(|T| + |P|)$ solution.

---

**Input Format**

- First line: the text string $T$ $(1 \\le |T| \\le 10^6)$
- Second line: the pattern string $P$ $(1 \\le |P| \\le 10^5,\\ |P| \\le |T|)$

Both strings consist of lowercase English letters only.

**Output Format**

Print all starting positions (0-indexed) where $P$ occurs in $T$, separated by spaces, in increasing order. If $P$ does not occur in $T$, print \`NONE\`.

---

**Sample Input 1**
\`\`\`
abxabcabcaby
abcaby
\`\`\`
**Sample Output 1**
\`\`\`
6
\`\`\`
**Explanation:** The pattern \`abcaby\` starts at index $6$ in \`abxabcabcaby\`.

---

**Sample Input 2**
\`\`\`
aaaaaa
aa
\`\`\`
**Sample Output 2**
\`\`\`
0 1 2 3 4
\`\`\`
**Explanation:** Overlapping matches: \`aa\` starts at positions $0, 1, 2, 3, 4$.

---

**Constraints**
- $1 \\le |T| \\le 10^6$
- $1 \\le |P| \\le 10^5$
- $|P| \\le |T|$
- Both strings contain only lowercase English letters

**Hint:** Build the **failure function** (partial match table) for $P$ in $O(|P|)$. Then scan $T$ left to right, using the failure function to skip redundant comparisons. When a full match is found at position $i$, record $i - |P| + 1$ and continue using the failure function for overlapping matches.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["abxabcabcaby\nabcaby", "6"],
        ["aaaaaa\naa", "0 1 2 3 4"],
      ],
      [
        ["hello\nhello", "0"],
        ["abcdef\nxyz", "NONE"],
        ["a\na", "0"],
        ["ab\nb", "1"],
        ["aaa\na", "0 1 2"],
        ["abababab\nabab", "0 2 4"],
        ["abcabcabc\nabc", "0 3 6"],
        ["aabaabaabaab\naab", "0 3 6 9"],
        ["mississippi\nissi", "1 4"],
        ["abcde\nabcde", "0"],
        ["abcde\nabcdef", "NONE"],
        ["aabaabaab\naab", "0 3 6"],
        ["xyzxyzxyz\nxyz", "0 3 6"],
        ["ababcababcababc\nababc", "0 5 10"],
        ["zzzzz\nzzz", "0 1 2"],
        ["abcabc\ncab", "2"],
        ["banana\nana", "1 3"],
        ["abababababab\nababab", "0 2 4 6"],
      ]
    ),
  },

  // ── Q2: Count Distinct Substrings ──────────────────────────────────────────
  {
    title: "Count Distinct Substrings",
    statement: `Given a string $S$, count the number of **distinct non-empty substrings** of $S$.

A substring is a contiguous sequence of characters within $S$. Two substrings are considered the same if and only if they have the same characters in the same order.

---

**Approach (Trie)**

Build a **trie** of all suffixes of $S$. Insert each suffix character by character. Each node in the trie corresponds to a unique substring. The answer is the total number of nodes in the trie (excluding the root).

---

**Input Format**

- A single line containing the string $S$ $(1 \\le |S| \\le 3000)$

The string consists of lowercase English letters only.

**Output Format**

Print a single integer — the number of distinct non-empty substrings of $S$.

---

**Sample Input 1**
\`\`\`
abc
\`\`\`
**Sample Output 1**
\`\`\`
6
\`\`\`
**Explanation:** The distinct substrings are: \`a\`, \`b\`, \`c\`, \`ab\`, \`bc\`, \`abc\` — total $6$.

---

**Sample Input 2**
\`\`\`
aab
\`\`\`
**Sample Output 2**
\`\`\`
5
\`\`\`
**Explanation:** The distinct substrings are: \`a\`, \`b\`, \`aa\`, \`ab\`, \`aab\` — total $5$. Note that \`a\` appears twice as a substring but is counted only once.

---

**Constraints**
- $1 \\le |S| \\le 3000$
- $S$ consists of lowercase English letters

**Hint:** For each starting index $i$ from $0$ to $|S|-1$, insert the suffix $S[i..n-1]$ into a trie character by character. Each time you create a **new node**, that represents a new distinct substring. The total number of nodes created (minus the root) is the answer. The time complexity is $O(|S|^2)$ which is fine for $|S| \\le 3000$.`,
    time_limit_ms: 3000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["abc", "6"],
        ["aab", "5"],
      ],
      [
        ["a", "1"],
        ["aa", "2"],
        ["ab", "3"],
        ["aaa", "3"],
        ["abab", "7"],
        ["abcd", "10"],
        ["aaaa", "4"],
        ["abba", "8"],
        ["abcabc", "15"],
        ["aaab", "7"],
        ["xyxy", "7"],
        ["abac", "9"],
        ["zzzz", "4"],
        ["aabb", "8"],
        ["abcba", "13"],
        ["ababab", "11"],
        ["abcab", "12"],
        ["aaaab", "9"],
      ]
    ),
  },

  // ── Q3: XOR Queries on Subarray ────────────────────────────────────────────
  {
    title: "XOR Queries on Subarray",
    statement: `You are given an array $A$ of $N$ non-negative integers and $Q$ queries. Each query gives you two indices $L$ and $R$ (0-indexed), and you must compute $A[L] \\oplus A[L+1] \\oplus \\cdots \\oplus A[R]$, where $\\oplus$ denotes the bitwise XOR operation.

---

**Efficient approach: Prefix XOR**

Build a prefix XOR array $\\text{pre}$ where $\\text{pre}[0] = 0$ and $\\text{pre}[i] = A[0] \\oplus A[1] \\oplus \\cdots \\oplus A[i-1]$.

Then the XOR of the subarray $A[L..R]$ is simply $\\text{pre}[R+1] \\oplus \\text{pre}[L]$.

---

**Input Format**

- First line: integer $N$ — size of array $(1 \\le N \\le 10^5)$
- Second line: $N$ space-separated non-negative integers $A[0], A[1], \\ldots, A[N-1]$ $(0 \\le A[i] \\le 10^9)$
- Third line: integer $Q$ — number of queries $(1 \\le Q \\le 10^5)$
- Next $Q$ lines: two integers $L$ and $R$ $(0 \\le L \\le R < N)$

**Output Format**

For each query, print a single integer — the XOR of the subarray $A[L..R]$.

---

**Sample Input 1**
\`\`\`
4
1 3 4 8
4
0 1
1 2
0 3
3 3
\`\`\`
**Sample Output 1**
\`\`\`
2
7
14
8
\`\`\`
**Explanation:**
- $A[0] \\oplus A[1] = 1 \\oplus 3 = 2$
- $A[1] \\oplus A[2] = 3 \\oplus 4 = 7$
- $A[0] \\oplus A[1] \\oplus A[2] \\oplus A[3] = 1 \\oplus 3 \\oplus 4 \\oplus 8 = 14$
- $A[3] = 8$

---

**Sample Input 2**
\`\`\`
3
5 2 7
2
0 2
1 1
\`\`\`
**Sample Output 2**
\`\`\`
0
2
\`\`\`
**Explanation:**
- $5 \\oplus 2 \\oplus 7 = 0$
- $A[1] = 2$

---

**Constraints**
- $1 \\le N \\le 10^5$
- $0 \\le A[i] \\le 10^9$
- $1 \\le Q \\le 10^5$
- $0 \\le L \\le R < N$

**Hint:** Build the prefix XOR array in $O(N)$. Each query is then answered in $O(1)$.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["4\n1 3 4 8\n4\n0 1\n1 2\n0 3\n3 3", "2\n7\n14\n8"],
        ["3\n5 2 7\n2\n0 2\n1 1", "0\n2"],
      ],
      [
        ["1\n0\n1\n0 0", "0"],
        ["1\n7\n1\n0 0", "7"],
        ["2\n1 1\n3\n0 0\n1 1\n0 1", "1\n1\n0"],
        ["2\n3 5\n1\n0 1", "6"],
        ["5\n1 2 3 4 5\n1\n0 4", "1"],
        ["5\n1 2 3 4 5\n1\n2 4", "2"],
        ["3\n6 6 6\n3\n0 2\n0 0\n1 2", "6\n6\n0"],
        ["4\n0 0 0 0\n2\n0 3\n1 2", "0\n0"],
        ["2\n15 15\n2\n0 1\n0 0", "0\n15"],
        ["4\n8 4 2 1\n3\n0 3\n0 1\n2 3", "15\n12\n3"],
        ["3\n10 20 30\n3\n0 2\n0 1\n1 2", "0\n30\n10"],
        ["5\n1 0 1 0 1\n3\n0 4\n1 3\n2 2", "1\n1\n1"],
        ["9\n255 128 64 32 16 8 4 2 1\n3\n0 8\n0 0\n8 8", "0\n255\n1"],
        ["5\n100 200 300 400 500\n3\n0 4\n1 3\n2 2", "484\n116\n300"],
        ["3\n1023 512 256\n3\n0 2\n0 1\n1 2", "255\n511\n768"],
        ["5\n7 11 13 17 19\n3\n0 4\n0 2\n3 4", "3\n1\n2"],
        ["6\n2 4 8 16 32 64\n3\n0 5\n0 2\n3 5", "126\n14\n112"],
        ["8\n1 1 1 1 1 1 1 1\n3\n0 7\n0 3\n4 7", "0\n0\n0"],
      ]
    ),
  },

  // ── Q4: Maximum XOR of Two Numbers ─────────────────────────────────────────
  {
    title: "Maximum XOR of Two Numbers",
    statement: `Given an array of $N$ non-negative integers, find the **maximum XOR** of any two elements in the array.

Formally, find the maximum value of $A[i] \\oplus A[j]$ where $0 \\le i < j < N$.

---

**Efficient Approach: Greedy Bit-by-Bit with Hash Set**

Process bits from the most significant bit (MSB) to the least significant bit (LSB). At each bit position $k$:

1. Let $\\text{mask}$ include all bits from the MSB down to bit $k$.
2. Collect the set of prefixes: $\\{A[i]\\ \\&\\ \\text{mask} : 0 \\le i < N\\}$.
3. Try to set bit $k$ in the answer: let $\\text{candidate} = \\text{current\\_max} \\mid (1 \\ll k)$.
4. Check if there exist two prefixes $p_1, p_2$ such that $p_1 \\oplus p_2 = \\text{candidate}$.
   - Equivalently, for each prefix $p$, check if $\\text{candidate} \\oplus p$ is in the prefix set.
5. If yes, update $\\text{current\\_max} = \\text{candidate}$.

This runs in $O(N \\log M)$ where $M$ is the maximum value.

---

**Input Format**

- First line: integer $N$ — size of the array $(2 \\le N \\le 2 \\times 10^5)$
- Second line: $N$ space-separated non-negative integers $(0 \\le A[i] \\le 10^9)$

**Output Format**

Print a single integer — the maximum XOR of any two elements.

---

**Sample Input 1**
\`\`\`
6
3 10 5 25 2 8
\`\`\`
**Sample Output 1**
\`\`\`
28
\`\`\`
**Explanation:** $5 \\oplus 25 = 00101_2 \\oplus 11001_2 = 11100_2 = 28$.

---

**Sample Input 2**
\`\`\`
12
14 70 53 83 49 91 36 80 92 51 66 70
\`\`\`
**Sample Output 2**
\`\`\`
127
\`\`\`

---

**Constraints**
- $2 \\le N \\le 2 \\times 10^5$
- $0 \\le A[i] \\le 10^9$

**Hint:** The greedy approach works because XOR prefers differing bits. By greedily trying to set each bit from MSB to LSB, you build the maximum possible XOR one bit at a time. An alternative $O(N \\log M)$ approach uses a **binary trie** of all numbers and queries each number against the trie to find its best XOR partner.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["6\n3 10 5 25 2 8", "28"],
        ["12\n14 70 53 83 49 91 36 80 92 51 66 70", "127"],
      ],
      [
        ["2\n0 0", "0"],
        ["2\n1 0", "1"],
        ["2\n1 2", "3"],
        ["2\n5 5", "0"],
        ["3\n1 2 3", "3"],
        ["3\n4 6 7", "3"],
        ["4\n1 1 1 1", "0"],
        ["8\n0 1 2 3 4 5 6 7", "7"],
        ["3\n8 16 32", "48"],
        ["3\n15 15 15", "0"],
        ["2\n255 0", "255"],
        ["2\n1023 512", "511"],
        ["4\n7 3 5 1", "6"],
        ["3\n100 200 300", "484"],
        ["4\n1000 2000 3000 4000", "3176"],
        ["6\n31 16 8 4 2 1", "30"],
        ["8\n128 64 32 16 8 4 2 1", "192"],
        ["4\n999 1 500 250", "998"],
      ]
    ),
  },

  // ── Q5: Shortest String Period (Z-Function) ────────────────────────────────
  {
    title: "Shortest String Period",
    statement: `A **period** of a string $S$ of length $n$ is a positive integer $p$ such that $S[i] = S[i \\bmod p]$ for all $0 \\le i < n$.

In other words, $S$ can be expressed by repeating its first $p$ characters (possibly with a partial copy at the end).

Find the **shortest period** of the given string.

---

**Approach: Z-Function**

The **Z-array** $Z$ of a string $S$ is defined as: $Z[i]$ is the length of the longest substring starting from $S[i]$ that matches a prefix of $S$. By convention, $Z[0] = |S|$ (or left undefined).

**Key insight:** $p$ is a valid period if and only if $p + Z[p] \\ge |S|$ (for $1 \\le p < |S|$). This means the suffix starting at position $p$ matches the prefix for at least $|S| - p$ characters, which is exactly the condition for $S$ to be periodic with period $p$.

The smallest such $p$ is the shortest period. If no $p < |S|$ satisfies the condition, the period is $|S|$ itself.

---

**Input Format**

- A single line containing the string $S$ $(1 \\le |S| \\le 10^6)$

The string consists of lowercase English letters only.

**Output Format**

Print a single integer — the length of the shortest period of $S$.

---

**Sample Input 1**
\`\`\`
abcabcabc
\`\`\`
**Sample Output 1**
\`\`\`
3
\`\`\`
**Explanation:** The prefix \`abc\` (length $3$) repeats: \`abc|abc|abc\`. So the shortest period is $3$.

---

**Sample Input 2**
\`\`\`
aaaa
\`\`\`
**Sample Output 2**
\`\`\`
1
\`\`\`
**Explanation:** The prefix \`a\` (length $1$) repeats: \`a|a|a|a\`. So the shortest period is $1$.

---

**Constraints**
- $1 \\le |S| \\le 10^6$
- $S$ consists of lowercase English letters

**Hint:** Compute the Z-array in $O(n)$. Then iterate $p$ from $1$ to $n-1$: if $p + Z[p] \\ge n$, return $p$. If no such $p$ is found, the answer is $n$ (the string has no repeating structure shorter than itself).`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["abcabcabc", "3"],
        ["aaaa", "1"],
      ],
      [
        ["a", "1"],
        ["ab", "2"],
        ["aa", "1"],
        ["aba", "2"],
        ["abab", "2"],
        ["abcabc", "3"],
        ["abaaba", "3"],
        ["abcdef", "6"],
        ["xyzxyz", "3"],
        ["aabaabaab", "3"],
        ["ababababab", "2"],
        ["abc", "3"],
        ["abcab", "3"],
        ["zzz", "1"],
        ["zzzzzz", "1"],
        ["xyxyxy", "2"],
        ["abcabcab", "3"],
        ["aabbaa", "4"],
      ]
    ),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Creating HOPE Day 3 — Praveen's Batch: Advanced Algorithms...\n");

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
- Questions cover **String Algorithms** (KMP, Z-function), **Trie**, and **Bit Manipulation** (XOR).
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
      ${"HOPE Day 3 — Praveen's Batch: Advanced Algorithms"},
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

  console.log(`\n✓ HOPE Day 3 — Praveen's Batch: Advanced Algorithms ready`);
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
