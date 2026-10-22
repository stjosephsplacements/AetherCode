/**
 * HOPE Day 4 — Praveen: Advanced Algorithms
 * Oct 10, 2026 | 7:50 AM – 9:20 AM IST | 60 minutes
 * 5 questions × 20 test cases (2 sample + 18 hidden)
 * Languages: c, cpp, python, java
 * Batches: 3Y-HOPE-B1, SEB-TEST
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

const QUESTIONS: Question[] = [

  // ── Q1: Prefix Count (Trie) ─────────────────────────────────────────────
  {
    title: "Prefix Count",
    topic: "Advanced Algorithms",
    difficulty: "medium",
    statement: `You are given $N$ words and $Q$ queries. For each query string, determine **how many** of the $N$ words have the query as a **prefix**.

---

**Input Format**

- First line: two integers $N$ and $Q$ — the number of words and the number of queries
- Next $N$ lines: one word per line (lowercase English letters only)
- Next $Q$ lines: one query string per line (lowercase English letters only)

**Output Format**

Print $Q$ lines — for each query, print the count of words that start with that query prefix.

---

**Sample Input 1**
\`\`\`
5 3
apple
app
application
bat
ball
ap
ba
cat
\`\`\`
**Sample Output 1**
\`\`\`
3
2
0
\`\`\`
**Explanation:** "ap" is a prefix of "apple", "app", "application" → 3. "ba" is a prefix of "bat", "ball" → 2. "cat" matches none → 0.

---

**Sample Input 2**
\`\`\`
3 2
hello
help
he
hel
hello
\`\`\`
**Sample Output 2**
\`\`\`
2
1
\`\`\`
**Explanation:** "hel" is a prefix of "hello" and "help" → 2. "hello" is a prefix of only "hello" → 1.

---

**Constraints**
- $1 \\le N, Q \\le 10^5$
- $1 \\le |\\text{word}|, |\\text{query}| \\le 100$
- All strings consist of lowercase English letters only

**Hint:** Build a **trie** from the $N$ words. At each trie node, store the count of words that pass through it. For each query, traverse the trie following query characters — the count at the last node is your answer. If you fall off the trie, the answer is 0.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["5 3\napple\napp\napplication\nbat\nball\nap\nba\ncat", "3\n2\n0"],
        ["3 2\nhello\nhelp\nhe\nhel\nhello", "2\n1"],
      ],
      [
        // Edge: single word, single query, exact match
        ["1 1\nabc\nabc", "1"],
        // Edge: single word, query longer than word
        ["1 1\nab\nabc", "0"],
        // Edge: single char words
        ["3 2\na\na\nb\na\nc", "2\n0"],
        // Edge: all same word
        ["4 1\ntest\ntest\ntest\ntest\ntest", "4"],
        // Edge: empty prefix = single char
        ["3 1\nxyz\nxab\nxqr\nx", "3"],
        // Query is full word
        ["2 2\ndog\ndog\ndog\ndo", "2\n2"],
        // No matches at all
        ["3 3\naaa\nbbb\nccc\nd\ne\nf", "0\n0\n0"],
        // All words share long prefix
        ["4 3\nabcde\nabcdf\nabcdg\nabcdh\nabcd\nabc\nab", "4\n4\n4"],
        // Mixed lengths
        ["5 4\na\nab\nabc\nabcd\nabcde\na\nab\nabcde\nabcdef", "5\n4\n1\n0"],
        // Single character queries
        ["4 2\ncat\ncar\ndog\ndeer\nc\nd", "2\n2"],
        // Longer queries
        ["3 2\nprogramming\nprogram\nproject\nprog\nprogramming", "2\n1"],
        // Disjoint sets
        ["6 3\nalpha\nbeta\ngamma\ndelta\nepsilon\nzeta\nal\nbe\nom", "1\n1\n0"],
        // Large identical prefix
        ["3 2\naaaaab\naaaaac\naaaaad\naaaaa\naaaaab", "3\n1"],
        // Two-char words
        ["5 3\nab\nac\nad\nba\nbc\na\nb\nc", "3\n2\n0"],
        // Query equals one word but not prefix of others
        ["4 2\nfoo\nfoobar\nbar\nbaz\nfoo\nbar", "2\n2"],
        // Stress: many words same prefix
        ["5 2\nza\nzb\nzc\nzd\nze\nz\nza", "5\n1"],
        // All words identical, query is prefix
        ["3 1\nmno\nmno\nmno\nmn", "3"],
      ]
    ),
  },

  // ── Q2: Single Number III (Bit Manipulation) ────────────────────────────
  {
    title: "Single Number III",
    topic: "Advanced Algorithms",
    difficulty: "medium",
    statement: `You are given an array of $N$ integers where **every element appears exactly twice**, except for **two elements** that appear exactly once. Find and print these two unique elements in **ascending order**.

---

**Input Format**

- First line: an integer $N$ — the size of the array $(2 \\le N \\le 2 \\times 10^5, N$ is even$)$
- Second line: $N$ space-separated integers

**Output Format**

Print the two unique numbers on a single line, separated by a space, in **ascending order**.

---

**Sample Input 1**
\`\`\`
6
1 2 1 3 2 5
\`\`\`
**Sample Output 1**
\`\`\`
3 5
\`\`\`
**Explanation:** 1 and 2 each appear twice. 3 and 5 each appear once. In ascending order: 3 5.

---

**Sample Input 2**
\`\`\`
4
-1 0 -1 99
\`\`\`
**Sample Output 2**
\`\`\`
0 99
\`\`\`
**Explanation:** -1 appears twice. 0 and 99 appear once. In ascending order: 0 99.

---

**Constraints**
- $2 \\le N \\le 2 \\times 10^5$
- $N$ is even
- $-10^9 \\le a_i \\le 10^9$
- Exactly two elements appear once; all others appear exactly twice

**Hint:** XOR all elements to get $a \\oplus b$ (the XOR of the two unique numbers). Find any set bit in this result — it distinguishes $a$ from $b$. Partition all elements by this bit and XOR each group separately to recover $a$ and $b$.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["6\n1 2 1 3 2 5", "3 5"],
        ["4\n-1 0 -1 99", "0 99"],
      ],
      [
        // Minimum: N=2
        ["2\n10 20", "10 20"],
        // Both negative
        ["4\n-5 -3 -5 -7", "-7 -3"],
        // One negative, one positive
        ["4\n4 -4 4 7", "-4 7"],
        // Zero and positive
        ["4\n0 5 5 8", "0 8"],
        // Large values
        ["4\n1000000000 -1000000000 1000000000 999999999", "-1000000000 999999999"],
        // Two adjacent values
        ["6\n1 1 2 2 3 4", "3 4"],
        // Two that are far apart
        ["6\n100 200 100 200 1 999", "1 999"],
        // Negatives and duplicates
        ["8\n-10 -20 -10 -20 -30 -40 5 5", "-40 -30"],
        // Unique values are 0 and 1
        ["6\n0 1 7 7 8 8", "0 1"],
        // Single pair + two uniques
        ["4\n42 42 1 2", "1 2"],
        // Tricky: values with same magnitude
        ["6\n5 -5 3 3 5 -10", "-10 -5"],
        // All positive
        ["8\n10 20 30 40 10 20 30 50", "40 50"],
        // Two large negatives
        ["4\n-999999999 -999999998 77 77", "-999999999 -999999998"],
        // Interleaved duplicates
        ["10\n1 2 3 1 2 3 4 5 4 6", "5 6"],
        // Powers of two
        ["6\n2 4 8 2 4 16", "8 16"],
        // Mixed sign with zero
        ["6\n0 -1 1 0 -1 2", "1 2"],
        // Large N pattern
        ["8\n100 200 300 400 100 200 300 500", "400 500"],
      ]
    ),
  },

  // ── Q3: Connected Components (Union-Find) ───────────────────────────────
  {
    title: "Connected Components",
    topic: "Advanced Algorithms",
    difficulty: "easy",
    statement: `You are given an **undirected graph** with $N$ nodes (numbered $1$ to $N$) and $M$ edges. Determine the **number of connected components** in the graph.

---

**Input Format**

- First line: two integers $N$ and $M$ — the number of nodes and edges
- Next $M$ lines: two integers $u$ and $v$ $(1 \\le u, v \\le N, u \\ne v)$ — an undirected edge

**Output Format**

Print a single integer — the number of connected components.

---

**Sample Input 1**
\`\`\`
5 3
1 2
2 3
4 5
\`\`\`
**Sample Output 1**
\`\`\`
2
\`\`\`
**Explanation:** Component 1: {1, 2, 3}. Component 2: {4, 5}. Total: 2 components.

---

**Sample Input 2**
\`\`\`
4 0
\`\`\`
**Sample Output 2**
\`\`\`
4
\`\`\`
**Explanation:** No edges, so each node is its own component.

---

**Constraints**
- $1 \\le N \\le 2 \\times 10^5$
- $0 \\le M \\le 2 \\times 10^5$
- $1 \\le u, v \\le N$, $u \\ne v$
- No duplicate edges

**Hint:** Use **Union-Find** (Disjoint Set Union) with **path compression** and **union by rank**. Initially each node is its own component ($N$ components). For each edge, union the two endpoints — if they were in different sets, the component count decreases by 1.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["5 3\n1 2\n2 3\n4 5", "2"],
        ["4 0", "4"],
      ],
      [
        // Single node
        ["1 0", "1"],
        // Two nodes, one edge
        ["2 1\n1 2", "1"],
        // Two nodes, no edge
        ["2 0", "2"],
        // All connected (chain)
        ["5 4\n1 2\n2 3\n3 4\n4 5", "1"],
        // Star graph
        ["5 4\n1 2\n1 3\n1 4\n1 5", "1"],
        // Three separate components
        ["6 3\n1 2\n3 4\n5 6", "3"],
        // One big + one isolated
        ["4 3\n1 2\n2 3\n3 4", "1"],
        // All isolated
        ["5 0", "5"],
        // Triangle + isolated pair
        ["5 4\n1 2\n2 3\n3 1\n4 5", "2"],
        // Two components of different sizes
        ["7 4\n1 2\n2 3\n4 5\n5 6", "2"],
        // Almost complete
        ["4 5\n1 2\n1 3\n1 4\n2 3\n3 4", "1"],
        // Chain with gap
        ["6 2\n1 2\n5 6", "4"],
        // Large chain
        ["10 9\n1 2\n2 3\n3 4\n4 5\n5 6\n6 7\n7 8\n8 9\n9 10", "1"],
        // Two equal components
        ["8 6\n1 2\n2 3\n3 4\n5 6\n6 7\n7 8", "2"],
        // Many isolated + one pair
        ["10 1\n3 7", "9"],
        // Cycle
        ["4 4\n1 2\n2 3\n3 4\n4 1", "1"],
        // Multiple small components
        ["9 3\n1 2\n4 5\n7 8", "6"],
        // Single edge in large graph
        ["100 1\n50 51", "99"],
      ]
    ),
  },

  // ── Q4: Count Pattern Occurrences (KMP/Z) ──────────────────────────────
  {
    title: "Count Pattern Occurrences",
    topic: "Advanced Algorithms",
    difficulty: "medium",
    statement: `You are given a **text** string $T$ and a **pattern** string $P$. Count the number of **non-overlapping** occurrences of $P$ in $T$.

When multiple matches overlap, prefer the **leftmost** match, then continue searching after it.

---

**Input Format**

- First line: the text string $T$
- Second line: the pattern string $P$

Both consist of lowercase English letters only.

**Output Format**

Print a single integer — the number of non-overlapping occurrences of $P$ in $T$.

---

**Sample Input 1**
\`\`\`
ababababab
aba
\`\`\`
**Sample Output 1**
\`\`\`
2
\`\`\`
**Explanation:** First match at index 0 ("**aba**bababab"). Skip to index 3. Second match at index 4 ("abab**aba**bab"). Skip to index 7. No more room. Total: 2.

---

**Sample Input 2**
\`\`\`
aaaa
aa
\`\`\`
**Sample Output 2**
\`\`\`
2
\`\`\`
**Explanation:** Match at index 0 ("**aa**aa"). Skip to index 2. Match at index 2 ("aa**aa**"). Total: 2.

---

**Constraints**
- $1 \\le |T| \\le 10^6$
- $1 \\le |P| \\le |T|$
- Both strings consist of lowercase English letters

**Hint:** Use the **KMP** (Knuth-Morris-Pratt) algorithm or **Z-algorithm** to find all occurrences in $O(|T| + |P|)$. After finding a match at position $i$, advance by $|P|$ to enforce non-overlapping.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["ababababab\naba", "2"],
        ["aaaa\naa", "2"],
      ],
      [
        // Exact match
        ["hello\nhello", "1"],
        // No match
        ["abcdef\nxyz", "0"],
        // Pattern longer than text
        ["ab\nabc", "0"],
        // Single char pattern
        ["aaa\na", "3"],
        // Single char, no match
        ["bbb\na", "0"],
        // Pattern at end
        ["xyzabc\nabc", "1"],
        // Pattern at start
        ["abcxyz\nabc", "1"],
        // Multiple non-overlapping
        ["abcabcabc\nabc", "3"],
        // Two non-overlapping matches
        ["aabaa\naa", "2"],
        // All same characters
        ["aaaaa\naa", "2"],
        // Pattern equals text
        ["test\ntest", "1"],
        // Repeated pattern cleanly
        ["xyzxyzxyzxyz\nxyz", "4"],
        // Almost match then real match
        ["aababc\nabc", "1"],
        // Pattern appears once in middle
        ["xxxabcyyy\nabc", "1"],
        // Two occurrences separated
        ["abcXXXabc\nabc", "2"],
        // Long repetition
        ["abababababababababab\nab", "10"],
        // No match with similar chars
        ["abababab\nba", "3"],
        // Single character each
        ["a\na", "1"],
        // Single character, no match
        ["a\nb", "0"],
      ]
    ),
  },

  // ── Q5: Shortest Path with Negative Edges (Bellman-Ford) ───────────────
  {
    title: "Shortest Path with Negative Edges",
    topic: "Advanced Algorithms",
    difficulty: "hard",
    statement: `You are given a **directed weighted graph** with $N$ nodes (numbered $1$ to $N$) and $M$ edges. Some edge weights may be **negative**. Find the **shortest path** from node $1$ to node $N$.

---

**Input Format**

- First line: two integers $N$ and $M$ — the number of nodes and edges
- Next $M$ lines: three integers $u$, $v$, $w$ — a directed edge from $u$ to $v$ with weight $w$

**Output Format**

- If node $N$ is **not reachable** from node $1$, print \`IMPOSSIBLE\`.
- If there is a **negative-weight cycle** on some path from node $1$ to node $N$ (making the shortest path $-\\infty$), print \`NEGATIVE CYCLE\`.
- Otherwise, print the **shortest distance** from node $1$ to node $N$.

---

**Sample Input 1**
\`\`\`
5 6
1 2 2
1 3 4
2 3 1
2 4 7
3 5 3
4 5 1
\`\`\`
**Sample Output 1**
\`\`\`
6
\`\`\`
**Explanation:** Shortest path: $1 \\to 2 \\to 3 \\to 5$ with cost $2 + 1 + 3 = 6$.

---

**Sample Input 2**
\`\`\`
3 3
1 2 1
2 3 -5
3 2 2
\`\`\`
**Sample Output 2**
\`\`\`
NEGATIVE CYCLE
\`\`\`
**Explanation:** Cycle $2 \\to 3 \\to 2$ has total weight $-5 + 2 = -3 < 0$. Node 3 is reachable from node 1 and is on a path to node 3 (which is N). So the shortest path is $-\\infty$.

---

**Sample Input 3**
\`\`\`
3 1
1 2 5
\`\`\`
**Sample Output 3**
\`\`\`
IMPOSSIBLE
\`\`\`
**Explanation:** No path exists from node 1 to node 3.

---

**Constraints**
- $1 \\le N \\le 2500$
- $0 \\le M \\le 5000$
- $1 \\le u, v \\le N$
- $-10^9 \\le w \\le 10^9$
- There may be self-loops and multiple edges between the same pair of nodes

**Hint:** Use the **Bellman-Ford** algorithm:
1. Run $N-1$ relaxation rounds.
2. Run one more round — if any distance to a node decreases, that node is on a negative cycle reachable from node $1$.
3. Check if node $N$ is affected by such a cycle (BFS/DFS from affected nodes).
4. If node $N$ is not reachable at all, print \`IMPOSSIBLE\`. If it's on a negative cycle path, print \`NEGATIVE CYCLE\`. Otherwise print the distance.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["5 6\n1 2 2\n1 3 4\n2 3 1\n2 4 7\n3 5 3\n4 5 1", "6"],
        ["3 3\n1 2 1\n2 3 -5\n3 2 2", "NEGATIVE CYCLE"],
      ],
      [
        // N unreachable
        ["3 1\n1 2 5", "IMPOSSIBLE"],
        // Direct edge
        ["2 1\n1 2 10", "10"],
        // Negative edge but no cycle
        ["3 2\n1 2 5\n2 3 -3", "2"],
        // Single node
        ["1 0", "0"],
        // Two paths, take shorter
        ["3 3\n1 2 10\n2 3 10\n1 3 5", "5"],
        // Negative cycle NOT on path to N
        ["4 4\n1 4 100\n2 3 -1\n3 2 -1\n1 2 1", "100"],
        // Self loop (negative)
        ["2 2\n1 1 -5\n1 2 3", "3"],
        // All negative edges, no cycle
        ["3 2\n1 2 -10\n2 3 -20", "-30"],
        // Longer path is cheaper
        ["4 5\n1 2 1\n2 4 100\n1 3 2\n3 2 -5\n2 4 100", "97"],
        // No edges at all, N>1
        ["3 0", "IMPOSSIBLE"],
        // Cycle not involving node N
        ["5 5\n1 2 1\n2 3 -10\n3 2 5\n1 4 50\n4 5 10", "60"],
        // Direct path + negative cycle to N
        ["4 5\n1 2 1\n2 3 -10\n3 2 5\n3 4 1\n2 4 100", "NEGATIVE CYCLE"],
        // Zero weight edges
        ["3 2\n1 2 0\n2 3 0", "0"],
        // Large positive weights
        ["2 1\n1 2 1000000000", "1000000000"],
        // Multiple edges same direction
        ["2 3\n1 2 10\n1 2 5\n1 2 3", "3"],
        // Chain with one negative
        ["5 4\n1 2 10\n2 3 -3\n3 4 10\n4 5 -3", "14"],
        // Diamond graph
        ["4 4\n1 2 1\n1 3 10\n2 4 10\n3 4 1", "11"],
      ]
    ),
  },

];

// ── Main: insert questions, create exam, link ────────────────────────────

async function main() {
  console.log("Creating HOPE Day 4 — Praveen: Advanced Algorithms...\n");

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
- Questions cover **Trie operations**, **Bit manipulation**, **Union-Find (Disjoint Sets)**, **String algorithms (KMP/Z)**, and **Bellman-Ford shortest paths**.
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
      ${"HOPE Day 4 — Praveen: Advanced Algorithms"},
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

  console.log(`\n✓ HOPE Day 4 — Praveen: Advanced Algorithms ready`);
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
