/**
 * HOPE Assessment — Linked List & Trees
 * Oct 10, 2026 | 7:50 AM – 9:20 AM IST | 90 minutes
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

  // ── Q1: Reverse the Linked List ─────────────────────────────────────────
  {
    title: "Reverse the Linked List",
    statement: `You are given a **singly linked list** represented as a sequence of integers. Your task is to **reverse** the linked list and output the values from head to tail of the reversed list.

The linked list is given as a space-separated sequence of integers on a single line.

---

**Input Format**

- First line: an integer $N$ — the number of nodes $(1 \\le N \\le 10^5)$
- Second line: $N$ space-separated integers — the values of nodes from head to tail $(1 \\le \\text{val} \\le 10^9)$

**Output Format**

Print $N$ space-separated integers — the node values from head to tail of the **reversed** linked list.

---

**Sample Input 1**
\`\`\`
5
1 2 3 4 5
\`\`\`
**Sample Output 1**
\`\`\`
5 4 3 2 1
\`\`\`
**Explanation:** The list $1 \\to 2 \\to 3 \\to 4 \\to 5$ reversed is $5 \\to 4 \\to 3 \\to 2 \\to 1$.

---

**Sample Input 2**
\`\`\`
3
7 14 21
\`\`\`
**Sample Output 2**
\`\`\`
21 14 7
\`\`\`

---

**Constraints**
- $1 \\le N \\le 10^5$
- $1 \\le \\text{val}[i] \\le 10^9$

**Hint:** Maintain three pointers: \`prev\`, \`curr\`, and \`next\`. At each step: save \`next = curr->next\`, point \`curr->next = prev\`, advance \`prev = curr\`, then \`curr = next\`. When \`curr\` is null, \`prev\` is the new head.`,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["5\n1 2 3 4 5", "5 4 3 2 1"],
        ["3\n7 14 21", "21 14 7"],
      ],
      [
        // Single node
        ["1\n42", "42"],
        // Two nodes
        ["2\n1 2", "2 1"],
        // Two nodes reversed
        ["2\n9 1", "1 9"],
        // All same values
        ["4\n5 5 5 5", "5 5 5 5"],
        // Palindrome — same after reversal
        ["5\n1 2 3 2 1", "1 2 3 2 1"],
        // Increasing
        ["6\n1 2 3 4 5 6", "6 5 4 3 2 1"],
        // Decreasing — becomes increasing
        ["6\n6 5 4 3 2 1", "1 2 3 4 5 6"],
        // Large values
        ["4\n1000000000 999999999 1 2", "2 1 999999999 1000000000"],
        // 10 nodes
        ["10\n10 9 8 7 6 5 4 3 2 1", "1 2 3 4 5 6 7 8 9 10"],
        // All ones
        ["5\n1 1 1 1 1", "1 1 1 1 1"],
        // Odd length
        ["7\n3 1 4 1 5 9 2", "2 9 5 1 4 1 3"],
        // Even length
        ["8\n8 7 6 5 4 3 2 1", "1 2 3 4 5 6 7 8"],
        // Alternating
        ["6\n1 2 1 2 1 2", "2 1 2 1 2 1"],
        // Single repeated value
        ["3\n100 100 100", "100 100 100"],
        // Two distinct values alternating
        ["5\n1 9 1 9 1", "1 9 1 9 1"],
        // Long ascending
        ["12\n1 2 3 4 5 6 7 8 9 10 11 12", "12 11 10 9 8 7 6 5 4 3 2 1"],
        // Stress — 20 nodes
        ["20\n20 19 18 17 16 15 14 13 12 11 10 9 8 7 6 5 4 3 2 1", "1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20"],
      ]
    ),
  },

  // ── Q2: Merge Two Sorted Lists ───────────────────────────────────────────
  {
    title: "Merge Two Sorted Lists",
    statement: `You are given two **sorted singly linked lists**. Merge them into a single **sorted linked list** and return it.

The merge must be done by **splicing the nodes together** (conceptually) — you are not allowed to create new nodes; you must reuse the existing node values. Print the final merged list.

---

**Input Format**

- First line: integer $M$ — length of the first list $(0 \\le M \\le 5 \\times 10^4)$
- Second line: $M$ space-separated integers in **non-decreasing order** (skip if $M = 0$)
- Third line: integer $N$ — length of the second list $(0 \\le N \\le 5 \\times 10^4)$
- Fourth line: $N$ space-separated integers in **non-decreasing order** (skip if $N = 0$)

**Output Format**

Print $M + N$ space-separated integers — the merged sorted list. Print a blank line if both lists are empty.

---

**Sample Input 1**
\`\`\`
3
1 2 4
3
1 3 4
\`\`\`
**Sample Output 1**
\`\`\`
1 1 2 3 4 4
\`\`\`

---

**Sample Input 2**
\`\`\`
0

3
1 2 3
\`\`\`
**Sample Output 2**
\`\`\`
1 2 3
\`\`\`
**Explanation:** First list is empty; the result is just the second list.

---

**Constraints**
- $0 \\le M, N \\le 5 \\times 10^4$
- $-10^4 \\le \\text{val}[i] \\le 10^4$
- Both input lists are sorted in **non-decreasing** order

**Hint:** Use a dummy head node. Maintain a pointer \`curr\` starting at the dummy. At each step compare the heads of the two lists and attach the smaller one to \`curr->next\`, then advance that list's pointer. When one list is exhausted, append the rest of the other.`,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["3\n1 2 4\n3\n1 3 4", "1 1 2 3 4 4"],
        ["0\n\n3\n1 2 3", "1 2 3"],
      ],
      [
        // Both empty
        ["0\n\n0\n", ""],
        // First empty
        ["0\n\n4\n2 4 6 8", "2 4 6 8"],
        // Second empty
        ["4\n1 3 5 7\n0\n", "1 3 5 7"],
        // Single elements — first smaller
        ["1\n1\n1\n2", "1 2"],
        // Single elements — second smaller
        ["1\n5\n1\n3", "3 5"],
        // All equal
        ["3\n2 2 2\n3\n2 2 2", "2 2 2 2 2 2"],
        // Interleaved
        ["4\n1 3 5 7\n4\n2 4 6 8", "1 2 3 4 5 6 7 8"],
        // First entirely before second
        ["3\n1 2 3\n3\n4 5 6", "1 2 3 4 5 6"],
        // Second entirely before first
        ["3\n4 5 6\n3\n1 2 3", "1 2 3 4 5 6"],
        // Negative values
        ["3\n-5 -3 -1\n3\n-4 -2 0", "-5 -4 -3 -2 -1 0"],
        // Mixed negative and positive
        ["3\n-2 0 4\n3\n-1 1 3", "-2 -1 0 1 3 4"],
        // Duplicates across lists
        ["4\n1 1 3 5\n4\n1 2 3 4", "1 1 1 2 3 3 4 5"],
        // Long first, short second
        ["6\n1 2 3 4 5 6\n2\n0 7", "0 1 2 3 4 5 6 7"],
        // Long second, short first
        ["2\n0 7\n6\n1 2 3 4 5 6", "0 1 2 3 4 5 6 7"],
        // All same value across both
        ["4\n3 3 3 3\n4\n3 3 3 3", "3 3 3 3 3 3 3 3"],
        // Large values
        ["3\n100 200 300\n3\n150 250 350", "100 150 200 250 300 350"],
        // One element each, equal
        ["1\n5\n1\n5", "5 5"],
        // Increasing by large gaps
        ["3\n10 20 30\n3\n15 25 35", "10 15 20 25 30 35"],
      ]
    ),
  },

  // ── Q3: Binary Tree — Level Order ────────────────────────────────────────
  {
    title: "Binary Tree Level Order Traversal",
    statement: `You are given a **binary tree** and asked to print its **level order traversal** — the nodes level by level, from left to right.

The tree is given in **BFS (level order) array representation**. Nodes are numbered from $1$. A value of $-1$ indicates a missing (null) node.

---

**Input Format**

- First line: integer $N$ — total number of entries in the array representation $(1 \\le N \\le 10^3)$
- Second line: $N$ space-separated integers — the level-order array, where $-1$ means null

**Output Format**

Print the level order traversal: each level on a **separate line**, values separated by spaces. Skip null nodes.

---

**Sample Input 1**
\`\`\`
7
3 9 20 -1 -1 15 7
\`\`\`
**Sample Output 1**
\`\`\`
3
9 20
15 7
\`\`\`
**Explanation:** Level $0$: node $3$. Level $1$: nodes $9$ and $20$. Level $2$: children of $9$ are null (skip), children of $20$ are $15$ and $7$.

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
- $1 \\le N \\le 10^3$
- $-10^3 \\le \\text{val}[i] \\le 10^3$ (use $-1$ for null; node values other than null will not equal $-1$)
- The root is always present (the first element is never $-1$)

**Hint:** Reconstruct the tree from the array first. Then perform a standard BFS using a queue. At each level, dequeue all nodes at the current depth, print their values, and enqueue their non-null children.`,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["7\n3 9 20 -1 -1 15 7", "3\n9 20\n15 7"],
        ["1\n1", "1"],
      ],
      [
        // Only root and one left child
        ["3\n1 2 -1", "1\n2"],
        // Only root and one right child
        ["3\n1 -1 2", "1\n2"],
        // Perfect binary tree, 3 levels
        ["7\n1 2 3 4 5 6 7", "1\n2 3\n4 5 6 7"],
        // Perfect binary tree, single path left
        ["5\n1 2 -1 3 -1", "1\n2\n3"],
        // Single path right
        ["5\n1 -1 2 -1 -1 -1 3", "1\n2\n3"],
        // Zig-zag tree
        ["7\n1 2 -1 -1 3 -1 -1", "1\n2\n3"],
        // 4-level complete tree
        ["15\n1 2 3 4 5 6 7 8 9 10 11 12 13 14 15", "1\n2 3\n4 5 6 7\n8 9 10 11 12 13 14 15"],
        // Negative values in tree
        ["7\n0 -2 3 -4 5 -6 7", "0\n-2 3\n-4 5 -6 7"],
        // Right-skewed
        ["7\n1 -1 2 -1 -1 -1 3", "1\n2\n3"],
        // All same value
        ["7\n5 5 5 5 5 5 5", "5\n5 5\n5 5 5 5"],
        // Missing last row partially
        ["10\n1 2 3 4 5 6 -1 7 8 -1 -1", "1\n2 3\n4 5 6\n7 8"],
        // Large values
        ["3\n1000 -1000 500", "1000\n-1000 500"],
        // Two-level tree, both children present
        ["3\n10 20 30", "10\n20 30"],
        // Tree with only left children at each level (3 levels)
        ["7\n1 2 -1 3 -1 -1 -1", "1\n2\n3"],
        // Mixed nulls
        ["11\n1 2 3 4 -1 -1 5 6 -1 -1 -1", "1\n2 3\n4 5\n6"],
        // Wider bottom level
        ["13\n1 2 3 4 5 -1 -1 7 8 9 10 -1 -1", "1\n2 3\n4 5\n7 8 9 10"],
        // Asymmetric tree
        ["9\n1 2 3 4 -1 -1 -1 5 -1", "1\n2 3\n4\n5"],
        // Single right branch deep
        ["11\n1 -1 2 -1 -1 -1 3 -1 -1 -1 -1", "1\n2\n3"],
      ]
    ),
  },

  // ── Q4: BST Insertion and Inorder ────────────────────────────────────────
  {
    title: "BST: Build and Traverse",
    statement: `A **Binary Search Tree (BST)** has the following property:
- For any node with value $v$: all values in its **left subtree** are **strictly less than** $v$, and all values in its **right subtree** are **strictly greater than** $v$.

You are given a sequence of distinct integers to **insert one by one** into an initially empty BST, in the order given. After all insertions, print the **inorder traversal** of the BST.

Recall: the inorder traversal of a BST always produces the values in **sorted (non-decreasing) order**.

---

**Input Format**

- First line: an integer $N$ — the number of values to insert $(1 \\le N \\le 10^4)$
- Second line: $N$ space-separated distinct integers $(1 \\le \\text{val}[i] \\le 10^9)$

**Output Format**

Print $N$ space-separated integers — the **inorder traversal** of the BST.

---

**Sample Input 1**
\`\`\`
5
5 3 7 1 4
\`\`\`
**Sample Output 1**
\`\`\`
1 3 4 5 7
\`\`\`
**Explanation:** After inserting $5, 3, 7, 1, 4$:
- $5$ is root
- $3$ goes left of $5$; $7$ goes right of $5$
- $1$ goes left of $3$; $4$ goes right of $3$

Inorder: $1, 3, 4, 5, 7$.

---

**Sample Input 2**
\`\`\`
3
10 5 15
\`\`\`
**Sample Output 2**
\`\`\`
5 10 15
\`\`\`

---

**Constraints**
- $1 \\le N \\le 10^4$
- All inserted values are **distinct**
- $1 \\le \\text{val}[i] \\le 10^9$

**Hint:** To insert value $x$: start at root. If $x < $ current node's value, go left; otherwise go right. When you reach a null pointer, create a new node there. For inorder traversal, recursively visit left subtree, print current node, then visit right subtree.`,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["5\n5 3 7 1 4", "1 3 4 5 7"],
        ["3\n10 5 15", "5 10 15"],
      ],
      [
        // Already sorted input — becomes right-skewed BST, inorder = sorted
        ["5\n1 2 3 4 5", "1 2 3 4 5"],
        // Reverse sorted — left-skewed BST
        ["5\n5 4 3 2 1", "1 2 3 4 5"],
        // Single node
        ["1\n42", "42"],
        // Two nodes, left child
        ["2\n10 5", "5 10"],
        // Two nodes, right child
        ["2\n5 10", "5 10"],
        // Powers of 2
        ["5\n16 8 32 4 12", "4 8 12 16 32"],
        // Balanced by insertion order
        ["7\n4 2 6 1 3 5 7", "1 2 3 4 5 6 7"],
        // Large values
        ["4\n1000000000 500000000 750000000 250000000", "250000000 500000000 750000000 1000000000"],
        // Zigzag insertion
        ["6\n5 3 7 4 2 6", "2 3 4 5 6 7"],
        // Right heavy then left
        ["6\n1 6 5 4 3 2", "1 2 3 4 5 6"],
        // 10 nodes
        ["10\n50 25 75 12 37 62 87 6 18 31", "6 12 18 25 31 37 50 62 75 87"],
        // Prime numbers
        ["6\n11 7 13 3 5 2", "2 3 5 7 11 13"],
        // Fibonacci-like
        ["7\n8 5 13 3 1 2 21", "1 2 3 5 8 13 21"],
        // Odd-even split
        ["6\n4 1 6 2 5 3", "1 2 3 4 5 6"],
        // Root is smallest
        ["5\n1 5 3 4 2", "1 2 3 4 5"],
        // Root is largest
        ["5\n10 8 6 4 2", "2 4 6 8 10"],
        // Dense cluster
        ["8\n100 50 150 25 75 125 175 60", "25 50 60 75 100 125 150 175"],
        // Palindrome values
        ["5\n5 3 7 3 5", "3 5 7"],
      ]
    ),
  },

  // ── Q5: Lowest Common Ancestor ───────────────────────────────────────────
  {
    title: "Lowest Common Ancestor in BST",
    statement: `The **Lowest Common Ancestor (LCA)** of two nodes $p$ and $q$ in a tree is the deepest node that is an ancestor of **both** $p$ and $q$ (a node is also an ancestor of itself).

You are given a **Binary Search Tree (BST)** built by inserting values one by one into an initially empty BST. Then you are given $Q$ queries. For each query, you are given two distinct values $p$ and $q$ that are guaranteed to exist in the BST. Find their LCA.

---

**How to use BST structure:**

In a BST, the LCA of $p$ and $q$ is the first node $v$ encountered (starting from the root) such that $p \\le v \\le q$ (or $q \\le v \\le p$). In other words:
- If both $p$ and $q$ are less than the current node, LCA is in the left subtree.
- If both $p$ and $q$ are greater than the current node, LCA is in the right subtree.
- Otherwise (they split or one equals the current node), the current node **is** the LCA.

---

**Input Format**

- First line: integer $N$ — number of values to build the BST $(1 \\le N \\le 10^4)$
- Second line: $N$ space-separated distinct integers $(1 \\le \\text{val} \\le 10^9)$
- Third line: integer $Q$ — number of queries $(1 \\le Q \\le 10^3)$
- Next $Q$ lines: two distinct integers $p$ and $q$ — both guaranteed to be in the BST

**Output Format**

For each query, print a single integer — the value of the LCA node.

---

**Sample Input 1**
\`\`\`
7
6 2 8 0 4 7 9
3
2 8
2 4
2 0
\`\`\`
**Sample Output 1**
\`\`\`
6
2
2
\`\`\`
**Explanation:**
- LCA(2, 8): $2 < 6$ and $8 > 6$, so the split happens at root $6$.
- LCA(2, 4): $2 < 6$ and $4 < 6$ → go left. At node $2$: $2 \\le 2 \\le 4$ → LCA is $2$.
- LCA(2, 0): $0 < 2 \\le 2$ → LCA is $2$.

---

**Sample Input 2**
\`\`\`
5
5 3 7 1 4
2
1 4
3 7
\`\`\`
**Sample Output 2**
\`\`\`
3
5
\`\`\`

---

**Constraints**
- $1 \\le N \\le 10^4$; all inserted values distinct
- $1 \\le Q \\le 10^3$
- $p \\ne q$; both $p$ and $q$ are in the BST

**Hint:** Build the BST from the given sequence. For each query $(p, q)$: start at root. Let $lo = \\min(p, q)$, $hi = \\max(p, q)$. If $hi < \\text{curr.val}$, go left. If $lo > \\text{curr.val}$, go right. Else \`curr\` is the LCA.`,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["7\n6 2 8 0 4 7 9\n3\n2 8\n2 4\n2 0", "6\n2\n2"],
        ["5\n5 3 7 1 4\n2\n1 4\n3 7", "3\n5"],
      ],
      [
        // LCA is root (nodes on opposite sides)
        ["5\n5 2 8 1 3\n1\n1 8", "5"],
        // LCA is one of the nodes itself
        ["5\n5 3 7 1 4\n1\n3 4", "3"],
        // LCA is leaf node (same node)
        ["5\n5 3 7 1 4\n1\n1 1", "1"],
        // Adjacent nodes — parent is LCA
        ["7\n4 2 6 1 3 5 7\n2\n1 2\n5 6", "2\n6"],
        // Balanced BST, nodes at same level
        ["7\n4 2 6 1 3 5 7\n1\n1 3", "2"],
        // Root is LCA for widely spread nodes
        ["7\n4 2 6 1 3 5 7\n1\n1 7", "4"],
        // Right subtree LCA
        ["7\n4 2 6 1 3 5 7\n1\n5 7", "6"],
        // Left subtree LCA
        ["7\n4 2 6 1 3 5 7\n1\n1 3", "2"],
        // One node is root
        ["5\n5 3 7 1 4\n1\n5 1", "5"],
        // Right-skewed BST
        ["5\n1 2 3 4 5\n2\n2 4\n1 5", "2\n1"],
        // Left-skewed BST
        ["5\n5 4 3 2 1\n2\n1 3\n2 5", "3\n5"],
        // Large values
        ["5\n500 200 800 100 300\n1\n100 300", "200"],
        // Multiple queries same pair
        ["5\n10 5 15 3 7\n3\n3 7\n5 15\n3 15", "5\n10\n10"],
        // Node and its sibling
        ["7\n8 3 10 1 6 9 14\n2\n1 6\n9 14", "3\n10"],
        // Deep ancestor
        ["9\n8 3 10 1 6 9 14 2 7\n2\n2 7\n1 7", "3\n3"],
        // All nodes on one side queried with root
        ["7\n4 2 6 1 3 5 7\n1\n2 6", "4"],
        // Adjacent siblings
        ["7\n4 2 6 1 3 5 7\n1\n3 5", "4"],
        // Query involving root and leaf
        ["7\n4 2 6 1 3 5 7\n1\n4 7", "4"],
      ]
    ),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Creating HOPE Assessment — Linked List & Trees...\n");

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

- This is a **90-minute** timed assessment. Your timer starts the moment you open the exam.
- You may use **C, C++, Python, or Java**.
- Each problem has **2 visible sample test cases** to help you verify your approach, and **18 hidden test cases** used for grading.
- Questions cover **Singly Linked Lists**, **Binary Trees**, and **Binary Search Trees (BST)**.
- Read each problem statement carefully, paying attention to constraints and edge cases.
- Partial credit is awarded per test case — a correct solution that passes all 20 cases earns full marks.
- Do **not** refresh the page or navigate away once you start.
- Good luck!`;

  const [{ id: examId }] = await sql<[{ id: string }]>`
    INSERT INTO exams (
      title, instructions, starts_at, ends_at, duration_minutes,
      languages, batches, published, created_by
    ) VALUES (
      'HOPE Assessment — Linked List & Trees',
      ${instructions},
      '2026-10-10 07:50:00+05:30',
      '2026-10-10 09:20:00+05:30',
      90,
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

  console.log(`\n✓ HOPE Assessment — Linked List & Trees ready`);
  console.log(`  Exam ID: ${examId}`);
  console.log(`  Questions: ${questionIds.length}`);
  console.log(`  Window: Oct 10, 2026 — 7:50 AM to 9:20 AM IST`);
  console.log(`  Duration: 90 minutes`);
  console.log(`  Batches: ${HOPE_BATCHES.join(", ")}`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
