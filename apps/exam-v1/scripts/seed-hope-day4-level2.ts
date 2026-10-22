/**
 * HOPE Day 4 — Level 2: Graph Foundations
 * Oct 10, 2026 | 7:50 AM – 9:20 AM IST | 60 minutes
 * 5 questions × 20 test cases (2 sample + 18 hidden)
 * Languages: c, cpp, python, java
 * Batches: 3Y-HOPE-B4, 3Y-HOPE-B5, SEB-TEST
 */

import { sql } from "../lib/db.ts";

const ADMIN_ID = "2cabecf4-74f4-461c-b596-d0fee3fb88b5";

const BATCHES = [
  "3Y-HOPE-B4",
  "3Y-HOPE-B5",
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

  // ── Q1: Number of Islands ───────────────────────────────────────────────
  {
    title: "Number of Islands",
    topic: "Graph Foundations",
    difficulty: "easy",
    statement: `You are given a 2D grid of size $R \\times C$ consisting of \`1\`s (land) and \`0\`s (water). An **island** is a group of connected \`1\`s, where connections are only **horizontal or vertical** (not diagonal). Count the number of islands.

---

**Input Format**

- First line: two integers $R$ and $C$ — the number of rows and columns $(1 \\le R, C \\le 500)$
- Next $R$ lines: a string of $C$ characters, each either \`0\` or \`1\`

**Output Format**

Print a single integer — the number of islands.

---

**Sample Input 1**
\`\`\`
4 5
11110
11010
11000
00000
\`\`\`
**Sample Output 1**
\`\`\`
1
\`\`\`
**Explanation:** All the \`1\`s are connected, forming a single island.

---

**Sample Input 2**
\`\`\`
4 5
11000
11000
00100
00011
\`\`\`
**Sample Output 2**
\`\`\`
3
\`\`\`
**Explanation:** There are three separate groups of connected land cells.

---

**Constraints**
- $1 \\le R, C \\le 500$
- The grid contains only the characters \`0\` and \`1\`

**Hint:** Use **BFS** or **DFS** from each unvisited land cell. Each time you start a new traversal, increment your island counter.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        // Sample 1: one big island
        ["4 5\n11110\n11010\n11000\n00000", "1"],
        // Sample 2: three islands
        ["4 5\n11000\n11000\n00100\n00011", "3"],
      ],
      [
        // Single cell land
        ["1 1\n1", "1"],
        // Single cell water
        ["1 1\n0", "0"],
        // All land
        ["3 3\n111\n111\n111", "1"],
        // All water
        ["3 3\n000\n000\n000", "0"],
        // Diagonal not connected
        ["3 3\n100\n010\n001", "3"],
        // Row of alternating
        ["1 5\n10101", "3"],
        // Column of alternating
        ["5 1\n1\n0\n1\n0\n1", "3"],
        // L-shaped island
        ["3 3\n110\n100\n100", "1"],
        // Two separate islands
        ["2 4\n1100\n0011", "2"],
        // U-shaped island
        ["3 3\n101\n101\n111", "1"],
        // Checkerboard 4x4
        ["4 4\n1010\n0101\n1010\n0101", "8"],
        // Single row all land
        ["1 6\n111111", "1"],
        // Single column all land
        ["6 1\n1\n1\n1\n1\n1\n1", "1"],
        // Frame island
        ["4 4\n1111\n1001\n1001\n1111", "1"],
        // Many small 1-cell islands
        ["3 5\n10101\n00000\n10101", "6"],
        // Two blobs connected by a thin bridge
        ["3 5\n11011\n00010\n00011", "2"],
        // Large empty with one island in center
        ["5 5\n00000\n01110\n01110\n01110\n00000", "1"],
      ]
    ),
  },

  // ── Q2: Course Schedule ─────────────────────────────────────────────────
  {
    title: "Course Schedule",
    topic: "Graph Foundations",
    difficulty: "medium",
    statement: `There are $N$ courses labeled $0$ to $N-1$. You are given $M$ prerequisite pairs. Each pair $[a, b]$ means you must complete course $b$ before taking course $a$.

Determine whether it is possible to finish all $N$ courses. Print \`YES\` if possible, \`NO\` otherwise.

---

**Input Format**

- First line: two integers $N$ and $M$ $(1 \\le N \\le 10^5,\\ 0 \\le M \\le 2 \\times 10^5)$
- Next $M$ lines: two integers $a$ and $b$ — meaning course $b$ is a prerequisite for course $a$

**Output Format**

Print \`YES\` or \`NO\`.

---

**Sample Input 1**
\`\`\`
4 3
1 0
2 1
3 2
\`\`\`
**Sample Output 1**
\`\`\`
YES
\`\`\`
**Explanation:** Take courses in order 0 → 1 → 2 → 3.

---

**Sample Input 2**
\`\`\`
2 2
1 0
0 1
\`\`\`
**Sample Output 2**
\`\`\`
NO
\`\`\`
**Explanation:** Course 0 requires 1 and course 1 requires 0 — a cycle.

---

**Constraints**
- $1 \\le N \\le 10^5$
- $0 \\le M \\le 2 \\times 10^5$
- $0 \\le a, b < N$

**Hint:** Build a directed graph and detect if it has a **cycle**. You can use **Kahn's algorithm** (BFS topological sort) or **DFS with coloring**. If a valid topological order exists (all nodes processed), print YES.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        // Sample 1: linear chain, no cycle
        ["4 3\n1 0\n2 1\n3 2", "YES"],
        // Sample 2: cycle of 2
        ["2 2\n1 0\n0 1", "NO"],
      ],
      [
        // Single course, no prereqs
        ["1 0", "YES"],
        // Two courses, no prereqs
        ["2 0", "YES"],
        // Three courses, no edges
        ["3 0", "YES"],
        // Self-loop
        ["1 1\n0 0", "NO"],
        // Triangle cycle
        ["3 3\n1 0\n2 1\n0 2", "NO"],
        // Diamond DAG (no cycle)
        ["4 4\n1 0\n2 0\n3 1\n3 2", "YES"],
        // Star from 0
        ["5 4\n1 0\n2 0\n3 0\n4 0", "YES"],
        // Long chain
        ["5 4\n1 0\n2 1\n3 2\n4 3", "YES"],
        // Cycle in a subgraph, but other nodes exist
        ["5 4\n1 0\n2 1\n0 2\n4 3", "NO"],
        // Parallel chains
        ["6 4\n1 0\n2 0\n4 3\n5 3", "YES"],
        // Two disjoint components, one has cycle
        ["4 3\n1 0\n3 2\n2 3", "NO"],
        // Complex DAG no cycle
        ["6 6\n1 0\n2 0\n3 1\n3 2\n4 3\n5 3", "YES"],
        // Large cycle of 4
        ["4 4\n1 0\n2 1\n3 2\n0 3", "NO"],
        // Single node self-loop
        ["2 1\n0 0", "NO"],
        // No prerequisites but many courses
        ["10 0", "YES"],
        // Two separate valid chains
        ["6 4\n1 0\n2 1\n4 3\n5 4", "YES"],
        // One edge, no cycle
        ["2 1\n1 0", "YES"],
      ]
    ),
  },

  // ── Q3: Bipartite Check ─────────────────────────────────────────────────
  {
    title: "Bipartite Check",
    topic: "Graph Foundations",
    difficulty: "medium",
    statement: `You are given an undirected graph with $N$ nodes (numbered $1$ to $N$) and $M$ edges. Determine whether the graph is **bipartite** — that is, whether you can color every node with one of two colors such that no two adjacent nodes share the same color.

---

**Input Format**

- First line: two integers $N$ and $M$ $(1 \\le N \\le 10^5,\\ 0 \\le M \\le 2 \\times 10^5)$
- Next $M$ lines: two integers $u$ and $v$ $(1 \\le u, v \\le N,\\ u \\ne v)$ — an edge between nodes $u$ and $v$

**Output Format**

Print \`YES\` if the graph is bipartite, or \`NO\` otherwise.

---

**Sample Input 1**
\`\`\`
4 4
1 2
2 3
3 4
4 1
\`\`\`
**Sample Output 1**
\`\`\`
YES
\`\`\`
**Explanation:** Color nodes 1,3 with color A and nodes 2,4 with color B. No edge connects two nodes of the same color.

---

**Sample Input 2**
\`\`\`
3 3
1 2
2 3
3 1
\`\`\`
**Sample Output 2**
\`\`\`
NO
\`\`\`
**Explanation:** A triangle (odd cycle) cannot be 2-colored.

---

**Constraints**
- $1 \\le N \\le 10^5$
- $0 \\le M \\le 2 \\times 10^5$
- No self-loops, but there may be multiple edges between the same pair

**Hint:** Use **BFS or DFS coloring**. Start from each unvisited node, assign it a color, and give the opposite color to its neighbors. If you ever find a neighbor already colored the same, the graph is not bipartite.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        // Sample 1: even cycle (square) — bipartite
        ["4 4\n1 2\n2 3\n3 4\n4 1", "YES"],
        // Sample 2: triangle (odd cycle) — not bipartite
        ["3 3\n1 2\n2 3\n3 1", "NO"],
      ],
      [
        // Single node, no edges
        ["1 0", "YES"],
        // Two nodes, one edge — trivially bipartite
        ["2 1\n1 2", "YES"],
        // Single node, no edges
        ["3 0", "YES"],
        // Path of 3 — bipartite
        ["3 2\n1 2\n2 3", "YES"],
        // Cycle of 5 (odd) — NOT bipartite
        ["5 5\n1 2\n2 3\n3 4\n4 5\n5 1", "NO"],
        // Cycle of 6 (even) — bipartite
        ["6 6\n1 2\n2 3\n3 4\n4 5\n5 6\n6 1", "YES"],
        // Star graph centered at 1
        ["5 4\n1 2\n1 3\n1 4\n1 5", "YES"],
        // Complete bipartite K2,3
        ["5 6\n1 3\n1 4\n1 5\n2 3\n2 4\n2 5", "YES"],
        // K4 (complete graph of 4) — not bipartite (contains triangle)
        ["4 6\n1 2\n1 3\n1 4\n2 3\n2 4\n3 4", "NO"],
        // Two disconnected components: one bipartite, one not
        ["6 5\n1 2\n2 3\n4 5\n5 6\n6 4", "NO"],
        // Two disconnected bipartite components
        ["6 4\n1 2\n2 3\n4 5\n5 6", "YES"],
        // Path of 5 — bipartite
        ["5 4\n1 2\n2 3\n3 4\n4 5", "YES"],
        // Cycle of 4 with extra edge forming triangle
        ["4 5\n1 2\n2 3\n3 4\n4 1\n1 3", "NO"],
        // Tree (always bipartite)
        ["7 6\n1 2\n1 3\n2 4\n2 5\n3 6\n3 7", "YES"],
        // Odd cycle inside a bigger graph
        ["7 8\n1 2\n2 3\n3 4\n4 5\n5 6\n6 7\n7 1\n3 5", "NO"],
        // Two nodes no edges — bipartite
        ["2 0", "YES"],
        // Bipartite graph: 4 nodes, matching edges only
        ["4 2\n1 3\n2 4", "YES"],
      ]
    ),
  },

  // ── Q4: Shortest Path in Unweighted Graph ───────────────────────────────
  {
    title: "Shortest Path in Unweighted Graph",
    topic: "Graph Foundations",
    difficulty: "medium",
    statement: `You are given an undirected, unweighted graph with $N$ nodes (numbered $1$ to $N$) and $M$ edges. Find the **shortest path length** (number of edges) from node $S$ to node $T$. If no path exists, print $-1$.

---

**Input Format**

- First line: four integers $N$, $M$, $S$, $T$ $(1 \\le N \\le 10^5,\\ 0 \\le M \\le 2 \\times 10^5,\\ 1 \\le S, T \\le N)$
- Next $M$ lines: two integers $u$ and $v$ $(1 \\le u, v \\le N)$ — an undirected edge

**Output Format**

Print a single integer — the shortest path length from $S$ to $T$, or $-1$ if unreachable.

---

**Sample Input 1**
\`\`\`
5 5 1 5
1 2
2 3
3 5
1 4
4 5
\`\`\`
**Sample Output 1**
\`\`\`
2
\`\`\`
**Explanation:** Shortest path: 1 → 4 → 5 (2 edges). The path 1 → 2 → 3 → 5 uses 3 edges.

---

**Sample Input 2**
\`\`\`
4 2 1 4
1 2
3 4
\`\`\`
**Sample Output 2**
\`\`\`
-1
\`\`\`
**Explanation:** Nodes 1 and 4 are in different connected components.

---

**Constraints**
- $1 \\le N \\le 10^5$
- $0 \\le M \\le 2 \\times 10^5$
- $1 \\le S, T \\le N$

**Hint:** Use **Breadth-First Search (BFS)** from node $S$. The first time you reach node $T$ gives the shortest path. If BFS finishes without reaching $T$, print $-1$.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        // Sample 1: two paths, shorter is length 2
        ["5 5 1 5\n1 2\n2 3\n3 5\n1 4\n4 5", "2"],
        // Sample 2: disconnected
        ["4 2 1 4\n1 2\n3 4", "-1"],
      ],
      [
        // S == T
        ["1 0 1 1", "0"],
        // S == T with edges
        ["3 2 2 2\n1 2\n2 3", "0"],
        // Direct edge
        ["2 1 1 2\n1 2", "1"],
        // No edges, S != T
        ["2 0 1 2", "-1"],
        // Linear chain of 5
        ["5 4 1 5\n1 2\n2 3\n3 4\n4 5", "4"],
        // Star graph, center to leaf
        ["5 4 1 5\n1 2\n1 3\n1 4\n1 5", "1"],
        // Star graph, leaf to leaf
        ["5 4 2 5\n1 2\n1 3\n1 4\n1 5", "2"],
        // Triangle, any pair
        ["3 3 1 3\n1 2\n2 3\n3 1", "1"],
        // Square, diagonal shortest path
        ["4 4 1 3\n1 2\n2 3\n3 4\n4 1", "2"],
        // Two components
        ["6 4 1 6\n1 2\n2 3\n4 5\n5 6", "-1"],
        // Two components, target in same component
        ["6 4 1 3\n1 2\n2 3\n4 5\n5 6", "2"],
        // Long path vs short path
        ["6 6 1 6\n1 2\n2 3\n3 4\n4 5\n5 6\n1 6", "1"],
        // Grid-like 2x3
        ["6 7 1 6\n1 2\n2 3\n4 5\n5 6\n1 4\n2 5\n3 6", "2"],
        // Single node
        ["1 0 1 1", "0"],
        // Path of length 3
        ["4 3 1 4\n1 2\n2 3\n3 4", "3"],
        // Complete graph K4, any pair is 1
        ["4 6 1 4\n1 2\n1 3\n1 4\n2 3\n2 4\n3 4", "1"],
        // Isolated target
        ["3 1 1 3\n1 2", "-1"],
      ]
    ),
  },

  // ── Q5: Number of Provinces ─────────────────────────────────────────────
  {
    title: "Number of Provinces",
    topic: "Graph Foundations",
    difficulty: "easy",
    statement: `You are given $N$ cities and an $N \\times N$ adjacency matrix \`isConnected\`, where \`isConnected[i][j] = 1\` means city $i$ and city $j$ are **directly connected**, and \`isConnected[i][j] = 0\` means they are not. A **province** is a group of directly or indirectly connected cities with no cities outside the group connected to it.

Return the total number of provinces.

---

**Input Format**

- First line: an integer $N$ — the number of cities $(1 \\le N \\le 500)$
- Next $N$ lines: $N$ space-separated integers (each 0 or 1) — the adjacency matrix

Note: \`isConnected[i][i] = 1\` always, and the matrix is symmetric.

**Output Format**

Print a single integer — the number of provinces.

---

**Sample Input 1**
\`\`\`
3
1 1 0
1 1 0
0 0 1
\`\`\`
**Sample Output 1**
\`\`\`
2
\`\`\`
**Explanation:** Cities 0 and 1 are connected (one province). City 2 is alone (second province).

---

**Sample Input 2**
\`\`\`
3
1 0 0
0 1 0
0 0 1
\`\`\`
**Sample Output 2**
\`\`\`
3
\`\`\`
**Explanation:** No two cities are connected — each city is its own province.

---

**Constraints**
- $1 \\le N \\le 500$
- \`isConnected[i][i] = 1\`
- \`isConnected[i][j] = isConnected[j][i]\`

**Hint:** Use **DFS, BFS, or Union-Find** to count connected components. Iterate through each city; if it hasn't been visited, start a traversal and increment the province count.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        // Sample 1: two provinces
        ["3\n1 1 0\n1 1 0\n0 0 1", "2"],
        // Sample 2: all isolated
        ["3\n1 0 0\n0 1 0\n0 0 1", "3"],
      ],
      [
        // Single city
        ["1\n1", "1"],
        // Two cities connected
        ["2\n1 1\n1 1", "1"],
        // Two cities not connected
        ["2\n1 0\n0 1", "2"],
        // All connected (complete graph)
        ["4\n1 1 1 1\n1 1 1 1\n1 1 1 1\n1 1 1 1", "1"],
        // All isolated
        ["4\n1 0 0 0\n0 1 0 0\n0 0 1 0\n0 0 0 1", "4"],
        // Chain: 0-1-2-3
        ["4\n1 1 0 0\n1 1 1 0\n0 1 1 1\n0 0 1 1", "1"],
        // Two pairs
        ["4\n1 1 0 0\n1 1 0 0\n0 0 1 1\n0 0 1 1", "2"],
        // Star centered at 0
        ["5\n1 1 1 1 1\n1 1 0 0 0\n1 0 1 0 0\n1 0 0 1 0\n1 0 0 0 1", "1"],
        // Three groups: {0,1}, {2,3}, {4}
        ["5\n1 1 0 0 0\n1 1 0 0 0\n0 0 1 1 0\n0 0 1 1 0\n0 0 0 0 1", "3"],
        // One big component and one isolated
        ["5\n1 1 1 1 0\n1 1 1 1 0\n1 1 1 1 0\n1 1 1 1 0\n0 0 0 0 1", "2"],
        // Two triangles
        ["6\n1 1 1 0 0 0\n1 1 1 0 0 0\n1 1 1 0 0 0\n0 0 0 1 1 1\n0 0 0 1 1 1\n0 0 0 1 1 1", "2"],
        // Ring of 4 (0-1-2-3-0)
        ["4\n1 1 0 1\n1 1 1 0\n0 1 1 1\n1 0 1 1", "1"],
        // Path 0-1, isolated 2,3,4
        ["5\n1 1 0 0 0\n1 1 0 0 0\n0 0 1 0 0\n0 0 0 1 0\n0 0 0 0 1", "4"],
        // All connected via transitive closure
        ["4\n1 1 0 0\n1 1 1 0\n0 1 1 1\n0 0 1 1", "1"],
        // Larger: 3 components
        ["6\n1 1 0 0 0 0\n1 1 0 0 0 0\n0 0 1 0 0 0\n0 0 0 1 1 1\n0 0 0 1 1 1\n0 0 0 1 1 1", "3"],
        // All connected
        ["5\n1 1 1 1 1\n1 1 1 1 1\n1 1 1 1 1\n1 1 1 1 1\n1 1 1 1 1", "1"],
      ]
    ),
  },

];

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Creating HOPE Day 4 — Level 2: Graph Foundations...\n");

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
- All questions are on **Graph Foundations**: BFS, DFS, cycle detection, bipartiteness, connected components.
- Read each problem statement carefully, paying attention to input format, constraints and edge cases.
- Partial credit is awarded per test case — a correct solution that passes all 20 cases earns full marks.
- Do **not** refresh the page or navigate away once you start.
- Good luck!`;

  const [{ id: examId }] = await sql<[{ id: string }]>`
    INSERT INTO exams (
      title, instructions, starts_at, ends_at, duration_minutes,
      languages, batches, published, created_by,
      require_fullscreen, block_external_paste, require_seb
    ) VALUES (
      ${"HOPE Day 4 — Level 2: Graph Foundations"},
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

  console.log(`\n✓ HOPE Day 4 — Level 2: Graph Foundations ready`);
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
