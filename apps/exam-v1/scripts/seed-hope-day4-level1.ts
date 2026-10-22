/**
 * HOPE Day 4 — Level 1: Greedy Arrays & Strings
 * Oct 10, 2026 | 7:50 AM – 9:20 AM IST | 60 minutes
 * 5 questions × 20 test cases (2 sample + 18 hidden)
 * Languages: c, cpp, python, java
 * Batches: 2Y-HOPE-B2, B3, B4, 3Y-HOPE-B6, B7, B8, SEB-TEST
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
  topic: string;
  difficulty: "easy" | "medium" | "hard";
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

  // ── Q1: Jump Game ─────────────────────────────────────────────────────────
  {
    title: "Jump Game",
    topic: "Greedy Arrays & Strings",
    difficulty: "easy",
    statement: `You are given an array of $N$ **non-negative integers** where each element represents the **maximum jump length** from that position. Starting at the first index, determine whether you can reach the **last index**.

---

**Input Format**

- First line: an integer $N$ — the size of the array $(1 \\le N \\le 10^5)$
- Second line: $N$ space-separated non-negative integers $a_1, a_2, \\ldots, a_N$ $(0 \\le a_i \\le 10^5)$

**Output Format**

Print \`YES\` if you can reach the last index, or \`NO\` otherwise.

---

**Sample Input 1**
\`\`\`
5
2 3 1 1 4
\`\`\`
**Sample Output 1**
\`\`\`
YES
\`\`\`
**Explanation:** Jump 1 step from index 0 to 1, then 3 steps from index 1 to 4.

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
**Explanation:** You always arrive at index 3 (value 0), so you can never reach index 4.

---

**Constraints**
- $1 \\le N \\le 10^5$
- $0 \\le a_i \\le 10^5$

**Hint:** Maintain a variable \`maxReach\` that tracks the farthest index you can reach. Scan left to right; if the current index exceeds \`maxReach\`, you're stuck.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        // Sample 1: can reach
        ["5\n2 3 1 1 4", "YES"],
        // Sample 2: cannot reach
        ["5\n3 2 1 0 4", "NO"],
      ],
      [
        // Edge: single element (already at last)
        ["1\n0", "YES"],
        // Edge: two elements, first is 0
        ["2\n0 1", "NO"],
        // Edge: two elements, first is 1
        ["2\n1 0", "YES"],
        // All zeros except first
        ["4\n3 0 0 0", "YES"],
        // All zeros
        ["4\n0 0 0 0", "NO"],
        // Large first jump
        ["6\n10 0 0 0 0 0", "YES"],
        // Barely reachable
        ["5\n1 1 1 1 0", "YES"],
        // Barely unreachable
        ["5\n1 1 1 0 1", "NO"],
        // All ones
        ["6\n1 1 1 1 1 1", "YES"],
        // Decreasing
        ["5\n4 3 2 1 0", "YES"],
        // Large jump at start
        ["3\n5 0 0", "YES"],
        // Zero in middle blocks
        ["6\n2 0 0 1 1 0", "NO"],
        // Alternating
        ["6\n2 0 2 0 2 0", "YES"],
        // Need exactly right jumps
        ["7\n1 2 0 1 0 0 0", "NO"],
        // Large reachable
        ["10\n9 0 0 0 0 0 0 0 0 0", "YES"],
        // Medium case
        ["8\n4 2 0 0 2 0 1 0", "YES"],
      ]
    ),
  },

  // ── Q2: Minimum Platforms ─────────────────────────────────────────────────
  {
    title: "Minimum Platforms",
    topic: "Greedy Arrays & Strings",
    difficulty: "medium",
    statement: `You are given the **arrival** and **departure** times of $N$ trains at a railway station. All times are given as **integers representing minutes from midnight** (0 to 1439). Find the **minimum number of platforms** required so that no train has to wait.

A platform is occupied from its arrival time until its departure time (inclusive). If one train departs at time $t$ and another arrives at time $t$, they **need separate platforms**.

---

**Input Format**

- First line: an integer $N$ — the number of trains $(1 \\le N \\le 10^5)$
- Second line: $N$ space-separated integers — arrival times
- Third line: $N$ space-separated integers — departure times

It is guaranteed that $\\text{arrival}[i] \\le \\text{departure}[i]$ for every train.

**Output Format**

Print a single integer — the minimum number of platforms required.

---

**Sample Input 1**
\`\`\`
6
900 940 950 1100 1500 1800
910 1200 1120 1130 1900 2000
\`\`\`
**Sample Output 1**
\`\`\`
3
\`\`\`
**Explanation:** At time 950, trains arriving at 900, 940, and 950 are all present (the first departs at 910, so it's gone; but trains 940→1200 and 950→1120 overlap with 1100→1130). The maximum overlap is 3.

---

**Sample Input 2**
\`\`\`
3
100 200 300
150 250 350
\`\`\`
**Sample Output 2**
\`\`\`
1
\`\`\`
**Explanation:** No two trains overlap — each departs before the next arrives.

---

**Constraints**
- $1 \\le N \\le 10^5$
- $0 \\le \\text{arrival}[i] \\le \\text{departure}[i] \\le 1439$

**Hint:** Sort all events (arrivals and departures) by time. Walk through them, incrementing a counter for arrivals and decrementing for departures. The peak counter value is the answer. Break ties by processing departures before arrivals if they are at different times, but if arrival = departure for different trains they need separate platforms, so process arrivals first when times are equal.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        // Sample 1
        ["6\n900 940 950 1100 1500 1800\n910 1200 1120 1130 1900 2000", "3"],
        // Sample 2: no overlap
        ["3\n100 200 300\n150 250 350", "1"],
      ],
      [
        // Single train
        ["1\n500\n600", "1"],
        // Two trains, no overlap
        ["2\n100 300\n200 400", "1"],
        // Two trains, overlap
        ["2\n100 150\n200 300", "2"],
        // Two trains, same time (arrival = departure of other needs separate)
        ["2\n100 200\n200 300", "2"],
        // All same time
        ["3\n100 100 100\n200 200 200", "3"],
        // Chain: each departs before next arrives
        ["4\n100 200 300 400\n150 250 350 450", "1"],
        // All overlap
        ["4\n100 100 100 100\n500 500 500 500", "4"],
        // Two overlap, two don't
        ["4\n100 110 300 310\n200 200 400 400", "2"],
        // Departure at same time as arrival of another (all 3 need platforms at t=200)
        ["3\n100 200 200\n200 300 400", "3"],
        // Nested intervals
        ["3\n100 150 200\n400 300 250", "3"],
        // One long train overlapping several short ones
        ["4\n100 200 300 400\n1000 250 350 450", "2"],
        // Five trains with complex overlap
        ["5\n100 120 140 160 180\n300 280 260 240 220", "5"],
        // Medium: 10 trains
        ["10\n0 10 20 30 40 50 60 70 80 90\n5 15 25 35 45 55 65 75 85 95", "1"],
        // Medium: 10 trains all overlapping
        ["10\n0 0 0 0 0 0 0 0 0 0\n100 100 100 100 100 100 100 100 100 100", "10"],
        // Two groups
        ["6\n100 110 120 500 510 520\n200 200 200 600 600 600", "3"],
        // No overlap: first departs before second arrives
        ["2\n100 150\n149 200", "1"],
      ]
    ),
  },

  // ── Q3: Partition Labels ──────────────────────────────────────────────────
  {
    title: "Partition Labels",
    topic: "Greedy Arrays & Strings",
    difficulty: "medium",
    statement: `You are given a string $S$ consisting of **lowercase English letters**. Partition the string into as many parts as possible so that **each letter appears in at most one part**. Print the sizes of the parts.

Note that the partition must use every character in $S$ and the parts are contiguous substrings.

---

**Input Format**

- A single line containing the string $S$ $(1 \\le |S| \\le 10^5)$

**Output Format**

Print the sizes of each part, separated by spaces, in the order they appear.

---

**Sample Input 1**
\`\`\`
ababcbacadefegdehijhklij
\`\`\`
**Sample Output 1**
\`\`\`
9 7 8
\`\`\`
**Explanation:** The partition is "ababcbaca", "defegde", "hijhklij". Each letter appears in exactly one part.

---

**Sample Input 2**
\`\`\`
eccbbbbdec
\`\`\`
**Sample Output 2**
\`\`\`
10
\`\`\`
**Explanation:** All characters overlap; the entire string is one partition.

---

**Constraints**
- $1 \\le |S| \\le 10^5$
- $S$ consists of lowercase English letters only.

**Hint:** First pass: record the **last occurrence** index of each character. Second pass: greedily extend the current partition until the index reaches the furthest last-occurrence of any character seen so far.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["ababcbacadefegdehijhklij", "9 7 8"],
        ["eccbbbbdec", "10"],
      ],
      [
        // Single char
        ["a", "1"],
        // All same
        ["aaaa", "4"],
        // All unique
        ["abcde", "1 1 1 1 1"],
        // Two chars interleaved
        ["abab", "4"],
        // Two separate groups
        ["aabb", "2 2"],
        // Three separate chars
        ["aabbcc", "2 2 2"],
        // One char forces merge
        ["abcba", "5"],
        // Long run then unique
        ["aaabbb", "3 3"],
        // Complex: a wraps everything
        ["abcda", "5"],
        // Just two chars separated
        ["abba", "4"],
        // Alternating two
        ["ababab", "6"],
        // Each char appears once
        ["abcdefghij", "1 1 1 1 1 1 1 1 1 1"],
        // First and last same
        ["abcdefga", "8"],
        // Three groups with one-char groups
        ["aabbc", "2 2 1"],
        // Medium: repeated pattern
        ["abcabcabc", "9"],
        // Edge: single repeated char
        ["zzzzzz", "6"],
        // Two groups: first half and second half
        ["abcdef", "1 1 1 1 1 1"],
      ]
    ),
  },

  // ── Q4: Gas Station Circuit ───────────────────────────────────────────────
  {
    title: "Gas Station Circuit",
    topic: "Greedy Arrays & Strings",
    difficulty: "medium",
    statement: `There are $N$ gas stations arranged in a **circular route**. The $i$-th station has $\\text{gas}[i]$ units of fuel, and it costs $\\text{cost}[i]$ units of fuel to travel from station $i$ to station $i+1$ (with station $N$ wrapping around to station $1$).

You start with an **empty tank** at one of the gas stations. Find the **starting station index** (0-indexed) from which you can travel around the entire circuit **exactly once**. If there are multiple valid starting stations, return the **smallest** index. If no such station exists, return $-1$.

---

**Input Format**

- First line: an integer $N$ — the number of gas stations $(1 \\le N \\le 10^5)$
- Second line: $N$ space-separated integers — $\\text{gas}[0], \\text{gas}[1], \\ldots, \\text{gas}[N-1]$
- Third line: $N$ space-separated integers — $\\text{cost}[0], \\text{cost}[1], \\ldots, \\text{cost}[N-1]$

**Output Format**

Print the 0-indexed starting station, or $-1$ if no valid start exists.

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
**Explanation:** Start at station 3 (gas=4), travel to 4 (cost=1, tank=3+5=8−2=6), to 0 (tank=6+1=7−3=4), to 1 (tank=4+2=6−4=2), to 2 (tank=2+3=5−5=0), back to 3.

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
**Explanation:** Total gas = 9, total cost = 10. Not enough fuel to complete the circuit.

---

**Constraints**
- $1 \\le N \\le 10^5$
- $0 \\le \\text{gas}[i], \\text{cost}[i] \\le 10^4$

**Hint:** If the **total gas ≥ total cost**, a solution always exists. Use a single pass: track a running surplus. Whenever the tank goes negative, the answer must be the next station. The smallest valid index is always found this way.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["5\n1 2 3 4 5\n3 4 5 1 2", "3"],
        ["3\n2 3 4\n3 4 3", "-1"],
      ],
      [
        // Single station, enough gas
        ["1\n5\n3", "0"],
        // Single station, not enough
        ["1\n2\n5", "-1"],
        // Single station, exact
        ["1\n3\n3", "0"],
        // Two stations, start at 0
        ["2\n4 1\n1 4", "0"],
        // Two stations, start at 1
        ["2\n1 4\n4 1", "1"],
        // Two stations, impossible
        ["2\n1 1\n2 2", "-1"],
        // All gas > all cost, start at 0
        ["3\n5 5 5\n1 1 1", "0"],
        // Exactly enough total, start at last
        ["4\n0 0 0 4\n1 1 1 1", "3"],
        // Start in the middle
        ["5\n0 0 5 0 0\n1 1 1 1 1", "2"],
        // All zeros
        ["3\n0 0 0\n0 0 0", "0"],
        // One big station compensates
        ["4\n0 0 10 0\n3 3 1 3", "2"],
        // Equal at every station
        ["3\n3 3 3\n3 3 3", "0"],
        // Last station is the answer
        ["4\n1 1 1 5\n2 2 2 2", "3"],
        // Complex case: net per station is -5,-3,-1,+1,+3,+5 → start at 3
        ["6\n1 2 3 4 5 6\n6 5 4 3 2 1", "3"],
        // Total gas < total cost
        ["4\n1 1 1 1\n2 2 2 2", "-1"],
        // Barely possible
        ["3\n3 1 1\n2 2 1", "0"],
        // Start at 0 with exact budget
        ["3\n2 2 2\n2 2 2", "0"],
      ]
    ),
  },

  // ── Q5: Largest Number ────────────────────────────────────────────────────
  {
    title: "Largest Number",
    topic: "Greedy Arrays & Strings",
    difficulty: "hard",
    statement: `Given a list of $N$ **non-negative integers**, arrange them such that they form the **largest possible number** and print it as a string.

If the result has leading zeros (i.e., all numbers are 0), print \`0\`.

---

**Input Format**

- First line: an integer $N$ — the number of integers $(1 \\le N \\le 10^5)$
- Second line: $N$ space-separated non-negative integers $a_1, a_2, \\ldots, a_N$ $(0 \\le a_i \\le 10^9)$

**Output Format**

Print the largest number that can be formed by concatenating the integers.

---

**Sample Input 1**
\`\`\`
4
10 2 9 39
\`\`\`
**Sample Output 1**
\`\`\`
939210
\`\`\`
**Explanation:** Comparing "9" with "39": "939" > "399", so 9 comes first. The optimal arrangement is $9, 39, 2, 10 \\to$ "939210".

---

**Sample Input 2**
\`\`\`
3
0 0 0
\`\`\`
**Sample Output 2**
\`\`\`
0
\`\`\`
**Explanation:** All zeros — the answer is simply "0", not "000".

---

**Constraints**
- $1 \\le N \\le 10^5$
- $0 \\le a_i \\le 10^9$

**Hint:** Sort the numbers using a custom comparator: for two numbers $a$ and $b$, compare the string concatenations $a+b$ vs $b+a$. Place the one that makes the larger concatenation first. Handle the all-zeros case by checking if the first element (after sorting) is "0".`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["4\n10 2 9 39", "939210"],
        ["3\n0 0 0", "0"],
      ],
      [
        // Single element
        ["1\n5", "5"],
        // Single zero
        ["1\n0", "0"],
        // Two elements
        ["2\n30 3", "330"],
        // Two elements reversed
        ["2\n3 30", "330"],
        // Two same
        ["2\n5 5", "55"],
        // All same digit
        ["3\n1 1 1", "111"],
        // Powers of 10
        ["3\n10 100 1000", "101001000"],
        // Tricky: 12 vs 121
        ["2\n12 121", "12121"],
        // Mix zeros and non-zeros
        ["3\n0 0 1", "100"],
        // Descending single digits
        ["5\n5 4 3 2 1", "54321"],
        // All nines
        ["3\n9 9 9", "999"],
        // Large and small
        ["2\n999 1", "9991"],
        // Tricky same prefix
        ["2\n34 3", "343"],
        // Classic example
        ["2\n9 90", "990"],
        // Three elements with zero
        ["3\n0 9 0", "900"],
        // Four elements
        ["4\n1 20 23 4", "423201"],
        // Bigger set
        ["5\n3 30 34 5 9", "9534330"],
      ]
    ),
  },

];

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Creating HOPE Day 4 — Level 1: Greedy Arrays & Strings...\n");

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
    console.log(`  Q${i + 1}: "${q.title}" [${q.difficulty}] — ${sampleCount} sample + ${hiddenCount} hidden [id: ${id}]`);
  }

  const instructions = `## Instructions

- This is a **1-hour** timed assessment. Your timer starts the moment you open the exam.
- You may use **C, C++, Python, or Java**.
- Each problem has **2 visible sample test cases** to help you verify your approach, and **18 hidden test cases** used for grading.
- All questions cover **Greedy Algorithms on Arrays & Strings** — look for greedy choices and sorting-based strategies.
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
      ${"HOPE Day 4 — Level 1: Greedy Arrays & Strings"},
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

  console.log(`\n✓ HOPE Day 4 — Level 1: Greedy Arrays & Strings ready`);
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
