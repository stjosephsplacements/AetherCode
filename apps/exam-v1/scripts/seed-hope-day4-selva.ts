/**
 * HOPE Day 4 — Selva: Linked Lists & Trees
 * Oct 10, 2026 | 7:50 AM – 9:20 AM IST | 60 minutes
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

  // ── Q1: Reverse Linked List in K-Groups ─────────────────────────────────
  {
    title: "Reverse Linked List in K-Groups",
    topic: "Linked Lists & Trees",
    difficulty: "hard",
    statement: `Given a singly linked list of $N$ nodes and an integer $K$, reverse every group of $K$ consecutive nodes. If the number of remaining nodes is less than $K$, leave them in their original order.

---

**Input Format**

- First line: two space-separated integers $N$ and $K$ $(1 \\le K \\le N \\le 10^5)$
- Second line: $N$ space-separated integers — the node values

**Output Format**

Print the $N$ values of the modified linked list, space-separated, on a single line.

---

**Sample Input 1**
\`\`\`
6 3
1 2 3 4 5 6
\`\`\`
**Sample Output 1**
\`\`\`
3 2 1 6 5 4
\`\`\`
**Explanation:** Nodes are grouped as \`[1,2,3]\` and \`[4,5,6]\`. Each group is reversed to get \`[3,2,1]\` and \`[6,5,4]\`.

---

**Sample Input 2**
\`\`\`
5 2
10 20 30 40 50
\`\`\`
**Sample Output 2**
\`\`\`
20 10 40 30 50
\`\`\`
**Explanation:** Groups: \`[10,20]\`, \`[30,40]\`, \`[50]\`. First two groups reversed; the last has only 1 element (less than $K=2$) so it stays.

---

**Constraints**
- $1 \\le N \\le 10^5$
- $1 \\le K \\le N$
- $-10^9 \\le \\text{val}[i] \\le 10^9$

**Hint:** Process the list in chunks of size $K$. For each complete chunk, reverse the sub-array in place. Leave the final chunk untouched if its length is less than $K$.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["6 3\n1 2 3 4 5 6", "3 2 1 6 5 4"],
        ["5 2\n10 20 30 40 50", "20 10 40 30 50"],
      ],
      [
        // Edge: K=1 (no change)
        ["4 1\n1 2 3 4", "1 2 3 4"],
        // Edge: K=N (reverse entire list)
        ["5 5\n1 2 3 4 5", "5 4 3 2 1"],
        // Edge: single element
        ["1 1\n42", "42"],
        // K=2, even length
        ["4 2\n5 6 7 8", "6 5 8 7"],
        // K=2, odd length
        ["3 2\n1 2 3", "2 1 3"],
        // K=3, leftover 1
        ["4 3\n10 20 30 40", "30 20 10 40"],
        // K=3, leftover 2
        ["5 3\n1 2 3 4 5", "3 2 1 4 5"],
        // All same values
        ["6 2\n7 7 7 7 7 7", "7 7 7 7 7 7"],
        // Negative values
        ["6 3\n-1 -2 -3 -4 -5 -6", "-3 -2 -1 -6 -5 -4"],
        // Large K = N-1
        ["5 4\n1 2 3 4 5", "4 3 2 1 5"],
        // Two elements, K=2
        ["2 2\n100 200", "200 100"],
        // Descending input
        ["6 2\n6 5 4 3 2 1", "5 6 3 4 1 2"],
        // K=4 exact fit
        ["8 4\n1 2 3 4 5 6 7 8", "4 3 2 1 8 7 6 5"],
        // K=4 with leftover 2
        ["10 4\n1 2 3 4 5 6 7 8 9 10", "4 3 2 1 8 7 6 5 9 10"],
        // Mixed pos/neg
        ["6 3\n-5 10 -15 20 -25 30", "-15 10 -5 30 -25 20"],
        // Large values
        ["4 2\n1000000000 -1000000000 999999999 -999999999", "-1000000000 1000000000 -999999999 999999999"],
        // K=N for larger list
        ["7 7\n7 6 5 4 3 2 1", "1 2 3 4 5 6 7"],
      ]
    ),
  },

  // ── Q2: Merge K Sorted Lists ────────────────────────────────────────────
  {
    title: "Merge K Sorted Lists",
    topic: "Linked Lists & Trees",
    difficulty: "medium",
    statement: `You are given $K$ sorted linked lists. Merge all of them into one sorted linked list and print the result.

---

**Input Format**

- First line: an integer $K$ — the number of sorted lists $(1 \\le K \\le 1000)$
- Next $K$ sections, each consisting of:
  - A line with an integer $L_i$ — the length of the $i$-th list $(0 \\le L_i \\le 10^4)$
  - A line with $L_i$ space-separated integers in **non-decreasing** order (if $L_i = 0$, this line is empty or absent)

The total number of elements across all lists does not exceed $10^5$.

**Output Format**

Print all merged elements in non-decreasing order, space-separated, on a single line. If the total number of elements is $0$, print \`EMPTY\`.

---

**Sample Input 1**
\`\`\`
3
3
1 4 5
3
1 3 4
2
2 6
\`\`\`
**Sample Output 1**
\`\`\`
1 1 2 3 4 4 5 6
\`\`\`
**Explanation:** Merging \`[1,4,5]\`, \`[1,3,4]\`, and \`[2,6]\` produces \`[1,1,2,3,4,4,5,6]\`.

---

**Sample Input 2**
\`\`\`
2
0

4
-3 -1 0 2
\`\`\`
**Sample Output 2**
\`\`\`
-3 -1 0 2
\`\`\`
**Explanation:** First list is empty, result is just the second list.

---

**Constraints**
- $1 \\le K \\le 1000$
- $0 \\le L_i \\le 10^4$; total elements $\\le 10^5$
- $-10^9 \\le \\text{val} \\le 10^9$

**Hint:** Use a **min-heap (priority queue)** with $K$ entries (one per list head). Repeatedly extract the minimum and advance that list's pointer.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["3\n3\n1 4 5\n3\n1 3 4\n2\n2 6", "1 1 2 3 4 4 5 6"],
        ["2\n0\n\n4\n-3 -1 0 2", "-3 -1 0 2"],
      ],
      [
        // Single list
        ["1\n5\n1 2 3 4 5", "1 2 3 4 5"],
        // All empty lists
        ["3\n0\n\n0\n\n0\n", "EMPTY"],
        // K=1 empty
        ["1\n0\n", "EMPTY"],
        // Two lists, one element each
        ["2\n1\n1\n1\n2", "1 2"],
        // Identical elements
        ["2\n3\n5 5 5\n3\n5 5 5", "5 5 5 5 5 5"],
        // Negative values
        ["2\n3\n-10 -5 -1\n3\n-8 -3 0", "-10 -8 -5 -3 -1 0"],
        // One element per list
        ["4\n1\n4\n1\n2\n1\n1\n1\n3", "1 2 3 4"],
        // Already merged (single big list)
        ["1\n6\n1 2 3 4 5 6", "1 2 3 4 5 6"],
        // Two lists interleaved
        ["2\n3\n1 3 5\n3\n2 4 6", "1 2 3 4 5 6"],
        // Lists of different sizes
        ["3\n1\n1\n5\n2 3 4 5 6\n2\n7 8", "1 2 3 4 5 6 7 8"],
        // Duplicates across lists
        ["3\n2\n1 3\n2\n1 3\n2\n1 3", "1 1 1 3 3 3"],
        // K=2, first empty second full
        ["2\n0\n\n3\n10 20 30", "10 20 30"],
        // Large negative and positive
        ["2\n2\n-1000000000 0\n2\n-999999999 1000000000", "-1000000000 -999999999 0 1000000000"],
        // K=5, single element each
        ["5\n1\n5\n1\n3\n1\n1\n1\n4\n1\n2", "1 2 3 4 5"],
        // All zeros
        ["3\n2\n0 0\n2\n0 0\n2\n0 0", "0 0 0 0 0 0"],
        // Descending across lists but each ascending
        ["3\n2\n7 8\n2\n4 5\n2\n1 2", "1 2 4 5 7 8"],
        // Mixed empty and non-empty
        ["4\n0\n\n2\n1 2\n0\n\n3\n3 4 5", "1 2 3 4 5"],
      ]
    ),
  },

  // ── Q3: Binary Tree Level Order Traversal ───────────────────────────────
  {
    title: "Binary Tree Level Order Traversal",
    topic: "Linked Lists & Trees",
    difficulty: "easy",
    statement: `Given a binary tree represented as a **level-order array**, print the values of the tree level by level.

---

**Input Format**

- First line: an integer $N$ — the number of elements in the level-order array $(1 \\le N \\le 10^4)$
- Second line: $N$ space-separated integers — the level-order representation. The value $-1001$ represents a **null** node (actual node values satisfy $-1000 \\le v \\le 1000$).

The first element is the root. For a node at index $i$ (0-indexed), its left child is at $2i+1$ and right child at $2i+2$ (if within bounds and not $-1001$).

**Output Format**

Print each level of the tree on a separate line. Values within a level are space-separated. Do **not** print null nodes.

---

**Sample Input 1**
\`\`\`
7
3 9 20 -1001 -1001 15 7
\`\`\`
**Sample Output 1**
\`\`\`
3
9 20
15 7
\`\`\`
**Explanation:** Level 0: \`[3]\`, Level 1: \`[9, 20]\`, Level 2: \`[15, 7]\`. Null children of 9 are skipped.

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
- $1 \\le N \\le 10^4$
- $-1000 \\le \\text{val} \\le 1000$ for actual nodes; $-1001$ means null

**Hint:** Use **BFS** with a queue. Start from the root, process level by level, and skip null entries.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["7\n3 9 20 -1001 -1001 15 7", "3\n9 20\n15 7"],
        ["1\n1", "1"],
      ],
      [
        // Only root
        ["1\n0", "0"],
        // Complete binary tree depth 2
        ["3\n1 2 3", "1\n2 3"],
        // Left-skewed
        ["7\n1 2 -1001 3 -1001 -1001 -1001", "1\n2\n3"],
        // Right-skewed
        ["7\n1 -1001 2 -1001 -1001 -1001 3", "1\n2\n3"],
        // Negative values
        ["7\n-5 -3 -8 -1 -4 -7 -10", "-5\n-3 -8\n-1 -4 -7 -10"],
        // Full depth-3 tree (15 nodes)
        ["15\n1 2 3 4 5 6 7 8 9 10 11 12 13 14 15", "1\n2 3\n4 5 6 7\n8 9 10 11 12 13 14 15"],
        // Sparse tree: root and right only
        ["3\n5 -1001 10", "5\n10"],
        // All zeros
        ["7\n0 0 0 0 0 0 0", "0\n0 0\n0 0 0 0"],
        // Mixed null in middle level
        ["7\n1 2 3 -1001 4 -1001 5", "1\n2 3\n4 5"],
        // Single negative
        ["1\n-1000", "-1000"],
        // Depth 2, one child each
        ["5\n10 20 30 -1001 -1001", "10\n20 30"],
        // Large values at bounds
        ["3\n1000 -1000 999", "1000\n-1000 999"],
        // Root with only left subtree 3 levels deep
        ["7\n5 3 -1001 1 4 -1001 -1001", "5\n3\n1 4"],
        // Complete tree depth 3 all same value
        ["7\n7 7 7 7 7 7 7", "7\n7 7\n7 7 7 7"],
        // Two levels, right child null
        ["3\n1 2 -1001", "1\n2"],
        // Two levels, left child null
        ["3\n1 -1001 3", "1\n3"],
        // Depth 3 with gaps
        ["15\n1 2 3 4 -1001 -1001 7 8 -1001 -1001 -1001 -1001 -1001 -1001 15", "1\n2 3\n4 7\n8 15"],
      ]
    ),
  },

  // ── Q4: Lowest Common Ancestor in BST ───────────────────────────────────
  {
    title: "Lowest Common Ancestor in BST",
    topic: "Linked Lists & Trees",
    difficulty: "medium",
    statement: `Given a **Binary Search Tree (BST)** and two node values $P$ and $Q$ that are guaranteed to exist in the tree, find the value of their **Lowest Common Ancestor (LCA)**.

The LCA of two nodes $P$ and $Q$ in a BST is the deepest node that is an ancestor of both $P$ and $Q$ (a node can be an ancestor of itself).

---

**Input Format**

- First line: an integer $N$ — the number of elements in the level-order array $(1 \\le N \\le 10^4)$
- Second line: $N$ space-separated integers — the BST in level-order. Use $-1001$ for null nodes (actual values satisfy $0 \\le v \\le 10^8$).
- Third line: two space-separated integers $P$ and $Q$ — the values to find the LCA of

**Output Format**

Print a single integer — the value of the LCA.

---

**Sample Input 1**
\`\`\`
9
6 2 8 0 4 7 9 -1001 -1001
2 8
\`\`\`
**Sample Output 1**
\`\`\`
6
\`\`\`
**Explanation:** The BST has root 6. Node 2 is in the left subtree, node 8 is in the right subtree, so the LCA is the root 6.

---

**Sample Input 2**
\`\`\`
9
6 2 8 0 4 7 9 -1001 -1001
2 4
\`\`\`
**Sample Output 2**
\`\`\`
2
\`\`\`
**Explanation:** Node 4 is in the subtree rooted at 2, so 2 is the LCA (a node is its own ancestor).

---

**Constraints**
- $1 \\le N \\le 10^4$
- $0 \\le \\text{val} \\le 10^8$
- All node values are **unique**
- $P \\ne Q$; both $P$ and $Q$ exist in the tree

**Hint:** In a BST, if both $P$ and $Q$ are smaller than the current node, the LCA is in the left subtree. If both are larger, it's in the right subtree. Otherwise, the current node is the LCA.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["9\n6 2 8 0 4 7 9 -1001 -1001\n2 8", "6"],
        ["9\n6 2 8 0 4 7 9 -1001 -1001\n2 4", "2"],
      ],
      [
        // LCA is root
        ["5\n5 3 7 -1001 -1001\n3 7", "5"],
        // LCA is one of the nodes (P is ancestor of Q)
        ["7\n20 10 30 5 15 -1001 -1001\n10 5", "10"],
        // LCA is one of the nodes (Q is ancestor of P)
        ["7\n20 10 30 5 15 -1001 -1001\n10 15", "10"],
        // Single path (skewed right BST)
        ["3\n1 -1001 2\n1 2", "1"],
        // Single path (skewed left BST)
        ["3\n3 2 -1001\n2 3", "3"],
        // Deep BST, LCA at an internal node
        ["15\n50 25 75 10 30 60 90 5 15 27 35 -1001 -1001 -1001 -1001\n5 35", "25"],
        // P and Q are leaves
        ["7\n4 2 6 1 3 5 7\n1 3", "2"],
        // P and Q are leaves, different subtrees
        ["7\n4 2 6 1 3 5 7\n3 5", "4"],
        // Large root value
        ["3\n100000000 50000000 99999999\n50000000 99999999", "100000000"],
        // LCA is in right subtree
        ["7\n10 5 20 -1001 -1001 15 25\n15 25", "20"],
        // LCA is in left subtree
        ["7\n10 5 20 3 7 -1001 -1001\n3 7", "5"],
        // Root is LCA, both in different subtrees
        ["7\n4 2 6 1 3 5 7\n1 7", "4"],
        // Adjacent values
        ["7\n4 2 6 1 3 5 7\n5 7", "6"],
        // Two nodes where one is root
        ["7\n4 2 6 1 3 5 7\n4 7", "4"],
        // Two nodes where one is root (other direction)
        ["7\n4 2 6 1 3 5 7\n1 4", "4"],
        // Deeper tree LCA at depth 1
        ["15\n8 4 12 2 6 10 14 1 3 5 7 9 11 13 15\n1 7", "4"],
        // Deeper tree LCA at depth 2
        ["15\n8 4 12 2 6 10 14 1 3 5 7 9 11 13 15\n9 11", "10"],
      ]
    ),
  },

  // ── Q5: Kth Smallest Element in BST ─────────────────────────────────────
  {
    title: "Kth Smallest Element in BST",
    topic: "Linked Lists & Trees",
    difficulty: "easy",
    statement: `Given a **Binary Search Tree (BST)** and an integer $K$, find the $K$-th smallest element in the BST.

---

**Input Format**

- First line: an integer $N$ — the number of elements in the level-order array $(1 \\le N \\le 10^4)$
- Second line: $N$ space-separated integers — the BST in level-order. Use $-1001$ for null nodes (actual values satisfy $0 \\le v \\le 10^8$).
- Third line: an integer $K$ $(1 \\le K \\le \\text{number of actual nodes})$

**Output Format**

Print a single integer — the $K$-th smallest value.

---

**Sample Input 1**
\`\`\`
7
3 1 4 -1001 2 -1001 -1001
1
\`\`\`
**Sample Output 1**
\`\`\`
1
\`\`\`
**Explanation:** In-order traversal of the BST gives \`[1, 2, 3, 4]\`. The 1st smallest is \`1\`.

---

**Sample Input 2**
\`\`\`
7
5 3 6 2 4 -1001 -1001
3
\`\`\`
**Sample Output 2**
\`\`\`
4
\`\`\`
**Explanation:** In-order: \`[2, 3, 4, 5, 6]\`. The 3rd smallest is \`4\`.

---

**Constraints**
- $1 \\le N \\le 10^4$
- $0 \\le \\text{val} \\le 10^8$
- All node values are **unique**
- $1 \\le K \\le$ total number of non-null nodes

**Hint:** Perform an **in-order traversal** (left → root → right) of the BST. The $K$-th node visited is the answer. You can stop early once you reach the $K$-th node.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["7\n3 1 4 -1001 2 -1001 -1001\n1", "1"],
        ["7\n5 3 6 2 4 -1001 -1001\n3", "4"],
      ],
      [
        // Single node, K=1
        ["1\n10\n1", "10"],
        // K = total nodes (find maximum)
        ["7\n4 2 6 1 3 5 7\n7", "7"],
        // K=1 (find minimum)
        ["7\n4 2 6 1 3 5 7\n1", "1"],
        // Perfect BST, K at median
        ["7\n4 2 6 1 3 5 7\n4", "4"],
        // Left-skewed BST
        ["7\n7 5 -1001 3 -1001 -1001 -1001\n1", "3"],
        // Left-skewed BST K=3 (max)
        ["7\n7 5 -1001 3 -1001 -1001 -1001\n3", "7"],
        // Right-skewed BST
        ["3\n1 -1001 3\n2", "3"],
        // Right-skewed BST K=1
        ["3\n1 -1001 3\n1", "1"],
        // Two nodes
        ["3\n2 1 -1001\n1", "1"],
        // Two nodes K=2
        ["3\n2 1 -1001\n2", "2"],
        // Larger perfect BST K=5
        ["15\n8 4 12 2 6 10 14 1 3 5 7 9 11 13 15\n5", "5"],
        // Larger perfect BST K=1
        ["15\n8 4 12 2 6 10 14 1 3 5 7 9 11 13 15\n1", "1"],
        // Larger perfect BST K=15
        ["15\n8 4 12 2 6 10 14 1 3 5 7 9 11 13 15\n15", "15"],
        // Larger perfect BST K=8 (root)
        ["15\n8 4 12 2 6 10 14 1 3 5 7 9 11 13 15\n8", "8"],
        // Large values
        ["3\n50000000 10000000 90000000\n2", "50000000"],
        // K=2 in 3-node tree
        ["3\n50000000 10000000 90000000\n3", "90000000"],
        // Deeper left subtree
        ["7\n10 5 15 2 7 -1001 -1001\n3", "7"],
      ]
    ),
  },

];

async function main() {
  console.log("Creating HOPE Day 4 — Selva: Linked Lists & Trees...\n");

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
- Each problem has **2 visible sample test cases** and **18 hidden test cases** used for grading.
- Questions cover **Singly Linked Lists** (K-group reversal, merging sorted lists) and **Binary Trees / BSTs** (level-order traversal, LCA, Kth smallest).
- For tree problems, the tree is given in **level-order array format**. Use **-1001** as the null sentinel (since node values can be up to 1000 in magnitude).
- Partial credit is awarded per test case — a correct solution that passes all 20 cases earns full marks.
- Do **not** refresh the page or navigate away once you start.
- Good luck!`;

  const [{ id: examId }] = await sql<[{ id: string }]>`
    INSERT INTO exams (
      title, instructions, starts_at, ends_at, duration_minutes,
      languages, batches, published, created_by,
      require_fullscreen, block_external_paste, require_seb
    ) VALUES (
      ${"HOPE Day 4 — Selva: Linked Lists & Trees"},
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

  console.log(`\n✓ HOPE Day 4 — Selva: Linked Lists & Trees ready`);
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
