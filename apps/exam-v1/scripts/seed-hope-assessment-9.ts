/**
 * HOPE Day 3 — Selva Sir's Batch: Linked List & Trees (Day 2)
 * Oct 7, 2026 | 6:00 PM – 10:00 PM IST | 120 minutes
 * 5 questions × 20 test cases (2 sample + 18 hidden)
 * Languages: c, cpp, python, java
 * Batches: 2Y-HOPE-B1, SEB-TEST
 */

import { sql } from "../lib/db.ts";

const ADMIN_ID = "2cabecf4-74f4-461c-b596-d0fee3fb88b5";

const BATCHES = [
  "2Y-HOPE-B1",
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

  // ── Q1: Detect Cycle in Linked List ──────────────────────────────────────
  {
    title: "Detect Cycle in Linked List",
    statement: `You are given a **singly linked list** of $N$ nodes. The **last node** might point back to one of the earlier nodes, forming a **cycle**. Determine whether the linked list contains a cycle.

---

**Input Format**

- First line: an integer $N$ — the number of nodes $(1 \\le N \\le 10^5)$
- Second line: $N$ space-separated integers — the values of the nodes from head to tail
- Third line: an integer $\\text{pos}$ — the **0-indexed** position of the node that the **tail** connects to. If $\\text{pos} = -1$, there is **no cycle**.

**Output Format**

Print \`YES\` if the linked list has a cycle, or \`NO\` otherwise.

---

**Sample Input 1**
\`\`\`
4
3 2 0 -4
1
\`\`\`
**Sample Output 1**
\`\`\`
YES
\`\`\`
**Explanation:** The tail node (value $-4$) connects back to node at index $1$ (value $2$), forming the cycle $2 \\to 0 \\to -4 \\to 2 \\to \\dots$

---

**Sample Input 2**
\`\`\`
3
1 2 3
-1
\`\`\`
**Sample Output 2**
\`\`\`
NO
\`\`\`
**Explanation:** The tail node points to null — no cycle exists.

---

**Constraints**
- $1 \\le N \\le 10^5$
- $-10^9 \\le \\text{val}[i] \\le 10^9$
- $-1 \\le \\text{pos} < N$

**Hint:** Use **Floyd's Cycle Detection** (tortoise and hare): maintain two pointers, \`slow\` (moves 1 step) and \`fast\` (moves 2 steps). If they ever meet, a cycle exists. If \`fast\` reaches null, there is no cycle.`,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["4\n3 2 0 -4\n1", "YES"],
        ["3\n1 2 3\n-1", "NO"],
      ],
      [
        ["1\n1\n-1", "NO"],
        ["1\n1\n0", "YES"],
        ["2\n1 2\n0", "YES"],
        ["2\n1 2\n-1", "NO"],
        ["5\n1 2 3 4 5\n-1", "NO"],
        ["5\n1 2 3 4 5\n0", "YES"],
        ["5\n1 2 3 4 5\n4", "YES"],
        ["5\n1 2 3 4 5\n2", "YES"],
        ["3\n1 1 1\n0", "YES"],
        ["6\n10 20 30 40 50 60\n-1", "NO"],
        ["6\n10 20 30 40 50 60\n3", "YES"],
        ["4\n5 5 5 5\n-1", "NO"],
        ["4\n5 5 5 5\n1", "YES"],
        ["7\n1 2 3 4 5 6 7\n5", "YES"],
        ["7\n1 2 3 4 5 6 7\n-1", "NO"],
        ["10\n1 2 3 4 5 6 7 8 9 10\n0", "YES"],
        ["10\n1 2 3 4 5 6 7 8 9 10\n-1", "NO"],
        ["8\n3 1 4 1 5 9 2 6\n4", "YES"],
      ]
    ),
  },

  // ── Q2: Palindrome Linked List ───────────────────────────────────────────
  {
    title: "Palindrome Linked List",
    statement: `You are given a **singly linked list** of $N$ nodes. Determine whether the linked list is a **palindrome** — i.e., it reads the same forwards and backwards.

---

**Input Format**

- First line: an integer $N$ — the number of nodes $(1 \\le N \\le 10^5)$
- Second line: $N$ space-separated integers — the node values from head to tail

**Output Format**

Print \`YES\` if the linked list is a palindrome, or \`NO\` otherwise.

---

**Sample Input 1**
\`\`\`
4
1 2 2 1
\`\`\`
**Sample Output 1**
\`\`\`
YES
\`\`\`
**Explanation:** Reading forwards: $1, 2, 2, 1$. Reading backwards: $1, 2, 2, 1$. They are the same — palindrome.

---

**Sample Input 2**
\`\`\`
3
1 2 3
\`\`\`
**Sample Output 2**
\`\`\`
NO
\`\`\`
**Explanation:** Forwards: $1, 2, 3$. Backwards: $3, 2, 1$. Not the same.

---

**Constraints**
- $1 \\le N \\le 10^5$
- $0 \\le \\text{val}[i] \\le 10^9$

**Hint:** Find the **middle** of the list using slow/fast pointers. **Reverse** the second half in-place. Compare the first half with the reversed second half node by node. If all values match, it is a palindrome.`,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["4\n1 2 2 1", "YES"],
        ["3\n1 2 3", "NO"],
      ],
      [
        ["1\n1", "YES"],
        ["2\n1 1", "YES"],
        ["2\n1 2", "NO"],
        ["3\n1 2 1", "YES"],
        ["5\n1 2 3 2 1", "YES"],
        ["5\n1 2 3 4 5", "NO"],
        ["5\n5 5 5 5 5", "YES"],
        ["6\n1 2 3 3 2 1", "YES"],
        ["7\n1 2 3 4 3 2 1", "YES"],
        ["5\n9 8 7 8 9", "YES"],
        ["6\n1 2 3 4 5 6", "NO"],
        ["3\n1 0 1", "YES"],
        ["4\n1 0 0 1", "YES"],
        ["4\n1 0 0 2", "NO"],
        ["7\n7 7 7 7 7 7 7", "YES"],
        ["5\n1 2 1 2 1", "YES"],
        ["4\n1 2 1 2", "NO"],
        ["5\n100 200 300 200 100", "YES"],
      ]
    ),
  },

  // ── Q3: Binary Tree Maximum Path Sum ─────────────────────────────────────
  {
    title: "Binary Tree Maximum Path Sum",
    statement: `A **path** in a binary tree is a sequence of nodes where each pair of adjacent nodes in the sequence has an edge connecting them. A node can only appear in the path **at most once**. The path does **not** need to pass through the root.

The **path sum** of a path is the sum of the node values in the path.

Given a binary tree, find the **maximum path sum** of any non-empty path.

---

**Input Format**

The tree is given in **level-order (BFS) array representation**.

- First line: integer $N$ — total entries in the level-order array $(1 \\le N \\le 10^3)$
- Second line: $N$ space-separated integers — the level-order array. Use $-1001$ to represent a **null** (missing) node. Node values are in the range $[-1000, 1000]$.

The root is always present (first element is never $-1001$).

**Output Format**

Print a single integer — the **maximum path sum**.

---

**Sample Input 1**
\`\`\`
3
1 2 3
\`\`\`
**Sample Output 1**
\`\`\`
6
\`\`\`
**Explanation:** The optimal path is $2 \\to 1 \\to 3$ with sum $2 + 1 + 3 = 6$.

---

**Sample Input 2**
\`\`\`
7
-10 9 20 -1001 -1001 15 7
\`\`\`
**Sample Output 2**
\`\`\`
42
\`\`\`
**Explanation:** The optimal path is $15 \\to 20 \\to 7$ with sum $15 + 20 + 7 = 42$.

---

**Constraints**
- $1 \\le N \\le 10^3$
- $-1000 \\le \\text{val}[i] \\le 1000$ (actual node values)
- $-1001$ represents a null node
- The tree has at least one node

**Hint:** Use a recursive DFS. For each node, compute the maximum **gain** from its left and right subtrees (clamp to 0 if negative — a subtree with negative gain is not worth including). The max path sum through the current node is \`node.val + leftGain + rightGain\`. Track the global maximum across all nodes. Return \`node.val + max(leftGain, rightGain)\` upward (a path can only extend in one direction to its parent).`,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["3\n1 2 3", "6"],
        ["7\n-10 9 20 -1001 -1001 15 7", "42"],
      ],
      [
        ["1\n5", "5"],
        ["1\n-3", "-3"],
        ["3\n1 2 -1001", "3"],
        ["3\n1 -1001 3", "4"],
        ["3\n2 -1 -1001", "2"],
        ["3\n-2 -1 -1001", "-1"],
        ["7\n1 2 3 4 5 6 7", "18"],
        ["3\n-1 -2 -3", "-1"],
        ["13\n5 4 8 11 -1001 13 4 7 2 -1001 -1001 -1001 1", "49"],
        ["7\n10 -5 20 -1001 -1001 15 7", "45"],
        ["7\n1 -2 3 -1001 -1001 -4 5", "9"],
        ["7\n-5 -2 -3 -4 -1001 -1001 -1001", "-2"],
        ["3\n0 -1 1", "1"],
        ["7\n3 -1001 5 -1001 -1001 -1001 6", "14"],
        ["7\n100 50 50 25 25 25 25", "250"],
        ["5\n-1 5 -1001 4 -1001", "9"],
        ["7\n2 1 3 -1001 -1001 -1001 4", "10"],
        ["13\n10 2 10 20 1 -25 -1001 -1001 -1001 -1001 -1001 3 4", "42"],
      ]
    ),
  },

  // ── Q4: Validate Binary Search Tree ──────────────────────────────────────
  {
    title: "Validate Binary Search Tree",
    statement: `A **Binary Search Tree (BST)** is a binary tree where for every node with value $v$:
- All values in its **left subtree** are **strictly less than** $v$.
- All values in its **right subtree** are **strictly greater than** $v$.

Given a binary tree, determine if it is a **valid BST**.

**Important:** It is not enough to check only the immediate children. A node in the left subtree of the root must be less than the root **even if it is several levels deep**.

---

**Input Format**

The tree is given in **level-order (BFS) array representation**.

- First line: integer $N$ — total entries in the level-order array $(1 \\le N \\le 10^3)$
- Second line: $N$ space-separated integers — the level-order array. Use $-1001$ to represent a **null** (missing) node. Node values are in the range $[-1000, 1000]$.

The root is always present.

**Output Format**

Print \`YES\` if the tree is a valid BST, or \`NO\` otherwise.

---

**Sample Input 1**
\`\`\`
3
2 1 3
\`\`\`
**Sample Output 1**
\`\`\`
YES
\`\`\`
**Explanation:** Left child $1 < 2$ (root), right child $3 > 2$ (root). Valid BST.

---

**Sample Input 2**
\`\`\`
7
5 1 4 -1001 -1001 3 6
\`\`\`
**Sample Output 2**
\`\`\`
NO
\`\`\`
**Explanation:** Node $4$ is the right child of root $5$, but $4 < 5$, so the right subtree constraint is violated.

---

**Constraints**
- $1 \\le N \\le 10^3$
- $-1000 \\le \\text{val}[i] \\le 1000$
- $-1001$ represents a null node

**Hint:** Use a recursive approach with **bounds**. For each node, track the allowed range $(\\text{lo}, \\text{hi})$. The root starts with $(-\\infty, +\\infty)$. When going left, update $\\text{hi} = \\text{node.val}$. When going right, update $\\text{lo} = \\text{node.val}$. If any node violates its bounds, return false.`,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["3\n2 1 3", "YES"],
        ["7\n5 1 4 -1001 -1001 3 6", "NO"],
      ],
      [
        ["1\n1", "YES"],
        ["3\n1 1 -1001", "NO"],
        ["7\n10 5 15 3 7 12 20", "YES"],
        ["7\n10 5 15 3 7 6 20", "NO"],
        ["7\n5 3 8 2 4 6 10", "YES"],
        ["7\n3 2 5 1 4 -1001 -1001", "NO"],
        ["3\n0 -1 1", "YES"],
        ["7\n100 50 150 25 75 125 175", "YES"],
        ["7\n5 4 6 -1001 -1001 3 7", "NO"],
        ["7\n10 5 15 -1001 -1001 10 20", "NO"],
        ["7\n-10 -20 0 -30 -15 -5 5", "YES"],
        ["7\n3 1 5 0 2 4 6", "YES"],
        ["7\n50 30 70 20 40 60 80", "YES"],
        ["3\n2 2 2", "NO"],
        ["7\n5 3 7 1 4 6 8", "YES"],
        ["7\n10 5 15 3 12 13 20", "NO"],
        ["7\n1 -1001 2 -1001 -1001 -1001 3", "YES"],
        ["14\n8 3 10 1 6 -1001 14 -1001 -1001 4 7 -1001 -1001 9", "NO"],
      ]
    ),
  },

  // ── Q5: Flatten Binary Tree to Pre-order ─────────────────────────────────
  {
    title: "Flatten Binary Tree to Pre-order",
    statement: `Given a binary tree, **flatten** it into a linked list in-place, following the **pre-order traversal** order.

In pre-order traversal, we visit the **root** first, then the **left subtree**, then the **right subtree**.

Your task: given a binary tree, output the values of all nodes in **pre-order** traversal order.

---

**Input Format**

The tree is given in **level-order (BFS) array representation**.

- First line: integer $N$ — total entries in the level-order array $(1 \\le N \\le 10^3)$
- Second line: $N$ space-separated integers — the level-order array. Use $-1001$ to represent a **null** (missing) node. Node values are in the range $[-1000, 1000]$.

The root is always present.

**Output Format**

Print the pre-order traversal as space-separated integers (only non-null nodes).

---

**Sample Input 1**
\`\`\`
5
1 2 3 4 5
\`\`\`
**Sample Output 1**
\`\`\`
1 2 4 5 3
\`\`\`
**Explanation:**
\`\`\`
        1
       / \\
      2   3
     / \\
    4   5
\`\`\`
Pre-order: visit $1$, then left subtree ($2 \\to 4, 5$), then right subtree ($3$). Result: $1, 2, 4, 5, 3$.

---

**Sample Input 2**
\`\`\`
6
1 -1001 2 -1001 -1001 3
\`\`\`
**Sample Output 2**
\`\`\`
1 2 3
\`\`\`
**Explanation:**
\`\`\`
    1
     \\
      2
     /
    3
\`\`\`
Pre-order: $1, 2, 3$.

---

**Constraints**
- $1 \\le N \\le 10^3$
- $-1000 \\le \\text{val}[i] \\le 1000$
- $-1001$ represents a null node

**Hint:** Build the tree from the level-order array (use a queue-based approach). Then perform a recursive or iterative pre-order traversal: visit root, recurse on left, recurse on right. Alternatively, use an explicit **stack**: push right child first, then left, so that left is processed first.`,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["5\n1 2 3 4 5", "1 2 4 5 3"],
        ["6\n1 -1001 2 -1001 -1001 3", "1 2 3"],
      ],
      [
        ["1\n5", "5"],
        ["3\n1 2 -1001", "1 2"],
        ["3\n1 -1001 2", "1 2"],
        ["7\n1 2 3 4 5 6 7", "1 2 4 5 3 6 7"],
        ["7\n1 2 3 -1001 -1001 4 5", "1 2 3 4 5"],
        ["7\n3 9 20 -1001 -1001 15 7", "3 9 20 15 7"],
        ["7\n10 5 15 3 7 12 20", "10 5 3 7 15 12 20"],
        ["5\n1 2 -1001 3 -1001", "1 2 3"],
        ["3\n-1 -2 -3", "-1 -2 -3"],
        ["7\n0 1 2 3 -1001 -1001 4", "0 1 3 2 4"],
        ["14\n8 3 10 1 6 -1001 14 -1001 -1001 4 7 -1001 -1001 13", "8 3 1 6 4 7 10 14 13"],
        ["7\n1 2 3 4 -1001 -1001 5", "1 2 4 3 5"],
        ["7\n100 50 150 25 75 125 175", "100 50 25 75 150 125 175"],
        ["7\n5 3 8 2 4 6 10", "5 3 2 4 8 6 10"],
        ["7\n1 -1001 2 -1001 -1001 -1001 3", "1 2 3"],
        ["1\n42", "42"],
        ["7\n1 2 3 -1001 4 5 -1001", "1 2 4 3 5"],
        ["15\n7 3 11 1 5 9 13 -1001 2 4 6 8 10 12 14", "7 3 1 2 5 4 6 11 9 8 10 13 12 14"],
      ]
    ),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Creating HOPE Day 3 — Selva Sir's Batch: Linked List & Trees (Day 2)...\n");

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
- Questions cover **Linked Lists** (cycle detection, palindrome check) and **Binary Trees** (max path sum, BST validation, pre-order traversal).
- For tree problems, the tree is given in **level-order array format**. Use **-1001** as the null sentinel (since node values can be negative).
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
      ${"HOPE Day 3 — Selva Sir's Batch: Linked List & Trees (Day 2)"},
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

  console.log(`\n✓ HOPE Day 3 — Selva Sir's Batch: Linked List & Trees (Day 2) ready`);
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
