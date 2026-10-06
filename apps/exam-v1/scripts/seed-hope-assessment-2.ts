/**
 * HOPE Assessment — Level 2: Graph Foundations
 * Oct 7, 2026 | 6:00 PM – 10:00 PM IST | 120 minutes
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

  // ── Q1: Count the Islands ────────────────────────────────────────────────
  {
    title: "Count the Islands",
    statement: `You are given a map of a region represented as a grid of $R$ rows and $C$ columns. Each cell contains either:
- \`1\` — land
- \`0\` — water

An **island** is a group of land cells connected **horizontally or vertically** (not diagonally). The boundary of the grid is surrounded by water.

Your task is to count the **total number of islands** in the map.

---

**Input Format**

- First line: two integers $R$ and $C$ — the number of rows and columns $(1 \\le R, C \\le 300)$
- Next $R$ lines: each line contains exactly $C$ characters, each either \`0\` or \`1\` (no spaces)

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
**Explanation:** All the \`1\`s in this grid are connected to each other (directly or indirectly through neighbours), so they form a single island.

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
**Explanation:** There are three separate groups of land cells — the top-left cluster, the single cell in the middle, and the two cells at the bottom-right. Each group forms one island.

---

**Constraints**
- $1 \\le R, C \\le 300$
- Each cell is either \`0\` or \`1\`

**Approach:** For each unvisited land cell, use DFS or BFS to visit and mark all connected land cells as part of the same island, then increment your island count.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["4 5\n11110\n11010\n11000\n00000", "1"],
        ["4 5\n11000\n11000\n00100\n00011", "3"],
      ],
      [
        // Single cell land
        ["1 1\n1", "1"],
        // Single cell water
        ["1 1\n0", "0"],
        // Entire grid water
        ["3 3\n000\n000\n000", "0"],
        // Entire grid land — one island
        ["2 2\n11\n11", "1"],
        // Diagonal cells: not connected
        ["2 2\n10\n01", "2"],
        // Checkerboard 3×3 = 5 islands
        ["3 3\n101\n010\n101", "5"],
        // Single row, alternating
        ["1 5\n10101", "3"],
        // Single column alternating
        ["5 1\n1\n0\n1\n0\n1", "3"],
        // Ring/donut shape — one island
        ["4 4\n1111\n1001\n1001\n1111", "1"],
        // Two horizontal strips
        ["3 5\n11011\n00000\n11011", "4"],
        // Large checkerboard 5×5 = 13 islands
        ["5 5\n10101\n01010\n10101\n01010\n10101", "13"],
        // All land single row
        ["1 6\n111111", "1"],
        // Vertical snake
        ["4 3\n110\n001\n110\n001", "4"],
        // Two large blobs
        ["4 8\n11110000\n11110000\n00001111\n00001111", "2"],
        // Long thin island
        ["5 5\n10000\n10000\n10000\n10000\n11111", "1"],
        // Islands touching corners diagonally only
        ["3 3\n100\n010\n001", "3"],
        // Cross shape — one island
        ["5 5\n00100\n00100\n11111\n00100\n00100", "1"],
        // Nested border island
        ["5 5\n11111\n10001\n10101\n10001\n11111", "2"],
      ]
    ),
  },

  // ── Q2: Colour Spread ────────────────────────────────────────────────────
  {
    title: "Colour Spread",
    statement: `You are given an image represented as a 2D grid of integers. Each integer represents the colour of that pixel.

You are also given:
- A **starting position** $(sr, sc)$ (0-indexed row and column)
- A **new colour** value

Perform a **flood fill** starting from pixel $(sr, sc)$: change the colour of the starting pixel and all pixels connected to it (directly or indirectly, 4-directionally) that share the **same original colour** as the starting pixel — to the new colour.

Return the resulting grid.

---

**Input Format**

- First line: three integers $R$, $C$, and $\\text{newColour}$ — grid dimensions and target colour $(1 \\le R, C \\le 50,\\ 0 \\le \\text{newColour} \\le 10^5)$
- Second line: two integers $sr$ and $sc$ — the starting pixel $(0 \\le sr < R,\\ 0 \\le sc < C)$
- Next $R$ lines: $C$ space-separated integers — the pixel colours $(0 \\le \\text{colour} \\le 10^5)$

**Output Format**

Print $R$ lines, each containing $C$ space-separated integers — the grid after the flood fill.

---

**Sample Input 1**
\`\`\`
3 3 2
1 1
1 1 1
1 1 0
1 1 1
\`\`\`
**Sample Output 1**
\`\`\`
2 2 2
2 2 0
2 2 2
\`\`\`
**Explanation:** Starting from $(1,1)$, the original colour is $1$. All cells connected to it with colour $1$ are changed to $2$. The single \`0\` in the middle-right is unaffected.

---

**Sample Input 2**
\`\`\`
2 2 3
0 0
1 2
1 2
\`\`\`
**Sample Output 2**
\`\`\`
1 2
1 2
\`\`\`
**Explanation:** Starting from $(0,0)$, the original colour is $1$. The new colour is also... wait — $3 \\ne 1$. Cell $(0,0)$ has colour $1$; $(1,0)$ has colour $1$; $(0,1)$ has colour $2$ — not connected. So only cells with colour $1$ on the left column are changed to $3$... but the new colour is $3$, so the output is:
\`\`\`
3 2
3 2
\`\`\`

---

**Constraints**
- $1 \\le R, C \\le 50$
- $0 \\le \\text{colour},\\ \\text{newColour} \\le 10^5$
- $0 \\le sr < R,\\ 0 \\le sc < C$

**Edge case:** If the starting pixel already has the new colour, no changes are needed — return the grid as-is.`,
    time_limit_ms: 2000,
    memory_limit_kb: 131072,
    test_cases: cases(
      [
        ["3 3 2\n1 1\n1 1 1\n1 1 0\n1 1 1", "2 2 2\n2 2 0\n2 2 2"],
        ["2 2 3\n0 0\n1 2\n1 2", "3 2\n3 2"],
      ],
      [
        // No change needed — already new colour
        ["1 1 5\n0 0\n5", "5"],
        // Entire grid same colour
        ["2 2 9\n0 0\n3 3\n3 3", "9 9\n9 9"],
        // Single cell, different colour
        ["1 1 7\n0 0\n4", "7"],
        // Fill only top-left corner
        ["3 3 0\n0 0\n1 1 2\n1 2 2\n2 2 2", "0 0 2\n0 2 2\n2 2 2"],
        // Fill middle island
        ["3 3 5\n1 1\n0 0 0\n0 1 0\n0 0 0", "0 0 0\n0 5 0\n0 0 0"],
        // Start at corner, fill L-shape
        ["3 3 4\n2 2\n1 1 0\n1 0 0\n0 0 0", "4 4 0\n4 0 0\n0 0 0"],
        // Flood hits boundary
        ["2 4 6\n0 0\n1 1 1 1\n0 0 0 0", "6 6 6 6\n0 0 0 0"],
        // Large uniform fill
        ["3 4 2\n1 2\n1 1 1 1\n1 1 1 1\n1 1 1 1", "1 1 2 1\n1 1 1 1\n1 1 1 1"],
        // Checkerboard — only one cell changes
        ["3 3 9\n0 0\n1 0 1\n0 1 0\n1 0 1", "9 0 1\n0 1 0\n1 0 1"],
        // Fill wraps around obstacle
        ["4 4 7\n0 0\n1 1 1 1\n1 0 0 1\n1 0 0 1\n1 1 1 1", "7 7 7 7\n7 0 0 7\n7 0 0 7\n7 7 7 7"],
        // New colour same as old — no change (edge)
        ["2 3 1\n0 0\n1 1 1\n0 0 0", "1 1 1\n0 0 0"],
        // Start at non-(0,0) position
        ["3 3 8\n2 1\n0 0 0\n0 1 0\n0 0 0", "0 0 0\n0 8 0\n0 0 0"],
        // Fill a row
        ["1 5 3\n0 0\n2 2 2 2 2", "3 3 3 3 3"],
        // Fill a column
        ["5 1 4\n0 0\n1\n1\n1\n1\n1", "4\n4\n4\n4\n4"],
        // Partial fill blocked by different colour
        ["3 3 6\n0 0\n1 2 1\n1 1 1\n1 2 1", "6 2 1\n6 6 6\n6 2 1"],
        // Already target colour — no change
        ["2 2 2\n1 1\n2 2\n2 2", "2 2\n2 2"],
        // Diagonal — not connected
        ["3 3 5\n0 0\n1 0 0\n0 1 0\n0 0 1", "5 0 0\n0 1 0\n0 0 1"],
        // Complex shape
        ["4 5 9\n1 1\n0 0 0 0 0\n0 1 1 1 0\n0 1 0 1 0\n0 1 1 1 0", "0 0 0 0 0\n0 9 9 9 0\n0 9 0 9 0\n0 9 9 9 0"],
      ]
    ),
  },

  // ── Q3: Find the Path ────────────────────────────────────────────────────
  {
    title: "Find the Path",
    statement: `You are given an **undirected graph** with $N$ nodes (numbered $1$ to $N$) and $M$ edges. Two nodes, $\\text{source}$ and $\\text{destination}$, are also given.

Determine whether there exists **any path** from $\\text{source}$ to $\\text{destination}$ in this graph.

---

**Input Format**

- First line: three integers $N$, $M$, $\\text{source}$, and $\\text{destination}$ — number of nodes, number of edges, and the two endpoints $(1 \\le N \\le 2 \\times 10^5,\\ 0 \\le M \\le 2 \\times 10^5,\\ 1 \\le \\text{source},\\ \\text{destination} \\le N)$
- Next $M$ lines: two integers $u$ and $v$ — an undirected edge between node $u$ and node $v$ $(1 \\le u, v \\le N,\\ u \\ne v)$

**Output Format**

Print \`YES\` if a path exists from source to destination, or \`NO\` otherwise.

---

**Sample Input 1**
\`\`\`
6 4 1 6
1 2
2 4
4 5
5 3
\`\`\`
**Sample Output 1**
\`\`\`
NO
\`\`\`
**Explanation:** Starting from node $1$, you can reach nodes $2$, $4$, $5$, and $3$ — but node $6$ is completely disconnected. There is no path from $1$ to $6$.

---

**Sample Input 2**
\`\`\`
4 3 1 4
1 2
2 3
3 4
\`\`\`
**Sample Output 2**
\`\`\`
YES
\`\`\`
**Explanation:** The path $1 \\to 2 \\to 3 \\to 4$ exists.

---

**Constraints**
- $1 \\le N \\le 2 \\times 10^5$
- $0 \\le M \\le 2 \\times 10^5$
- $1 \\le \\text{source},\\ \\text{destination} \\le N$
- No self-loops; edges may repeat (multigraph is allowed)

**Hint:** Use BFS, DFS, or Union-Find to determine if the source and destination belong to the same connected component.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["6 4 1 6\n1 2\n2 4\n4 5\n5 3", "NO"],
        ["4 3 1 4\n1 2\n2 3\n3 4", "YES"],
      ],
      [
        // Source equals destination
        ["5 3 3 3\n1 2\n3 4\n4 5", "YES"],
        // No edges at all, src != dst
        ["5 0 1 5", "NO"],
        // No edges, src == dst
        ["3 0 2 2", "YES"],
        // Direct edge between src and dst
        ["3 1 1 2\n1 2", "YES"],
        // Indirect path
        ["5 4 1 5\n1 2\n2 3\n3 4\n4 5", "YES"],
        // Disconnected graph
        ["6 4 1 5\n1 2\n2 3\n4 5\n5 6", "NO"],
        // Both in same component via cycle
        ["4 4 1 3\n1 2\n2 3\n3 4\n4 1", "YES"],
        // Large isolated node
        ["10 5 1 10\n1 2\n2 3\n3 4\n4 5\n5 6", "NO"],
        // Path requires all edges
        ["6 5 1 6\n1 2\n2 3\n3 4\n4 5\n5 6", "YES"],
        // Parallel edges — still YES
        ["3 3 1 2\n1 2\n1 2\n1 2", "YES"],
        // Bidirectional (undirected) test
        ["3 1 2 1\n1 2", "YES"],
        // Star graph — all connected
        ["5 4 2 5\n1 2\n1 3\n1 4\n1 5", "YES"],
        // Two clusters, src and dst in different clusters
        ["6 4 1 4\n1 2\n2 3\n4 5\n5 6", "NO"],
        // Long chain, start to middle
        ["10 9 1 5\n1 2\n2 3\n3 4\n4 5\n5 6\n6 7\n7 8\n8 9\n9 10", "YES"],
        // Large N, 0 edges
        ["200000 0 1 200000", "NO"],
        // Triangle — all reachable
        ["3 3 1 3\n1 2\n2 3\n1 3", "YES"],
        // Bridge graph — must cross bridge
        ["6 5 1 6\n1 2\n2 3\n3 4\n4 5\n5 6", "YES"],
        // Multigraph with isolated component
        ["8 6 1 8\n1 2\n1 2\n2 3\n3 1\n4 5\n6 7", "NO"],
      ]
    ),
  },

  // ── Q4: Friendship Clusters ──────────────────────────────────────────────
  {
    title: "Friendship Clusters",
    statement: `In a network of $N$ people (numbered $1$ to $N$), some pairs of people are **directly** friends. Friendship is transitive: if A is friends with B and B is friends with C, then A, B, and C all belong to the same **friendship cluster** (also called a province or connected component).

Given the friendship relationships, count the **total number of friendship clusters**.

---

**Input Format**

- First line: two integers $N$ and $M$ — number of people and number of direct friendships $(1 \\le N \\le 2 \\times 10^5,\\ 0 \\le M \\le 2 \\times 10^5)$
- Next $M$ lines: two integers $u$ and $v$ — person $u$ and person $v$ are directly friends $(1 \\le u, v \\le N,\\ u \\ne v)$

**Output Format**

Print a single integer — the number of friendship clusters.

---

**Sample Input 1**
\`\`\`
6 4
1 2
2 3
4 5
1 4
\`\`\`
**Sample Output 1**
\`\`\`
2
\`\`\`
**Explanation:** Edges $1$-$2$, $2$-$3$, $4$-$5$, $1$-$4$ connect all six people... wait, person $6$ has no friends, so they form their own cluster. Actually nodes $1$, $2$, $3$, $4$, $5$ are all connected, and node $6$ is alone. That gives **2** clusters.

---

**Sample Input 2**
\`\`\`
5 3
1 2
3 4
5 1
\`\`\`
**Sample Output 2**
\`\`\`
2
\`\`\`
**Explanation:** $\\{1, 2, 5\\}$ form one cluster, $\\{3, 4\\}$ form another. Total = $2$.

---

**Constraints**
- $1 \\le N \\le 2 \\times 10^5$
- $0 \\le M \\le 2 \\times 10^5$
- No self-loops

**Hint:** This is equivalent to counting connected components in an undirected graph. BFS, DFS, or Union-Find all work.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["6 4\n1 2\n2 3\n4 5\n1 4", "2"],
        ["5 3\n1 2\n3 4\n5 1", "2"],
      ],
      [
        // Everyone isolated
        ["5 0", "5"],
        // Single person
        ["1 0", "1"],
        // All in one cluster
        ["4 4\n1 2\n2 3\n3 4\n4 1", "1"],
        // Pairs — N/2 clusters
        ["6 3\n1 2\n3 4\n5 6", "3"],
        // Star graph — 1 cluster
        ["5 4\n1 2\n1 3\n1 4\n1 5", "1"],
        // Chain — 1 cluster
        ["5 4\n1 2\n2 3\n3 4\n4 5", "1"],
        // Two separate chains
        ["8 6\n1 2\n2 3\n3 4\n5 6\n6 7\n7 8", "2"],
        // Multiple isolated plus one cluster
        ["7 2\n1 2\n3 4", "4"],
        // Complete graph K4 — 1 cluster
        ["4 6\n1 2\n1 3\n1 4\n2 3\n2 4\n3 4", "1"],
        // Two triangles
        ["6 6\n1 2\n2 3\n3 1\n4 5\n5 6\n6 4", "2"],
        // Large N, no edges
        ["200000 0", "200000"],
        // Single edge
        ["200000 1\n1 200000", "199999"],
        // Bridge connecting two cliques
        ["6 7\n1 2\n2 3\n3 1\n4 5\n5 6\n6 4\n3 4", "1"],
        // N=2, no edge
        ["2 0", "2"],
        // N=2, one edge
        ["2 1\n1 2", "1"],
        // Cycle of 6
        ["6 6\n1 2\n2 3\n3 4\n4 5\n5 6\n6 1", "1"],
        // Three isolated components of size 3
        ["9 6\n1 2\n2 3\n4 5\n5 6\n7 8\n8 9", "3"],
        // Hub and spoke with one isolated
        ["6 4\n1 2\n1 3\n1 4\n1 5", "2"],
      ]
    ),
  },

  // ── Q5: Escape the Maze ──────────────────────────────────────────────────
  {
    title: "Escape the Maze",
    statement: `You are trapped inside a maze represented as a grid of $R$ rows and $C$ columns. Each cell is either:
- \`.\` — open floor (you can walk here)
- \`#\` — wall (you cannot pass through)

You start at the **top-left corner** $(0, 0)$ and want to reach the **bottom-right corner** $(R-1, C-1)$.

You can move **up, down, left, or right** — one step at a time. You cannot move diagonally and cannot go outside the grid.

Find the **minimum number of steps** to reach the exit. If it is impossible to escape, print $-1$.

It is guaranteed that the start and end cells are always open (\`.\`).

---

**Input Format**

- First line: two integers $R$ and $C$ $(1 \\le R, C \\le 500)$
- Next $R$ lines: a string of $C$ characters, each either \`.\` or \`#\`

**Output Format**

Print a single integer — the minimum number of steps, or $-1$ if no path exists.

---

**Sample Input 1**
\`\`\`
4 4
....
.##.
.##.
....
\`\`\`
**Sample Output 1**
\`\`\`
6
\`\`\`
**Explanation:** The walls block the direct path. One shortest route is:
$(0,0) \\to (1,0) \\to (2,0) \\to (3,0) \\to (3,1) \\to (3,2) \\to (3,3)$ — 6 steps.

---

**Sample Input 2**
\`\`\`
3 3
.#.
###
.#.
\`\`\`
**Sample Output 2**
\`\`\`
-1
\`\`\`
**Explanation:** The walls completely cut off any path from $(0,0)$ to $(2,2)$.

---

**Constraints**
- $1 \\le R, C \\le 500$
- Each cell is \`.\` or \`#\`
- $(0,0)$ and $(R-1,C-1)$ are always \`.\`

**Hint:** Use BFS (Breadth-First Search) starting from $(0,0)$. BFS always finds the shortest path in an unweighted grid.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        ["4 4\n....\n.##.\n.##.\n....", "6"],
        ["3 3\n.#.\n###\n.#.", "-1"],
      ],
      [
        // 1×1 grid — already at destination
        ["1 1\n.", "0"],
        // Straight line, no walls
        ["1 5\n.....", "4"],
        // Vertical line, no walls
        ["5 1\n.\n.\n.\n.\n.", "4"],
        // 2×2 open
        ["2 2\n..\n..", "2"],
        // 2×2 blocked corner
        ["2 2\n.#\n#.", "-1"],
        // Long corridor around obstacle
        ["3 5\n.....\n####.\n.....", "8"],
        // Fully open grid 3×3
        ["3 3\n...\n...\n...", "4"],
        // Blocked in the middle
        ["3 3\n...\n.#.\n...", "4"],
        // Only one route
        ["5 5\n.....\n####.\n.....\n.####\n.....", "16"],
        // No path — wall across entire middle
        ["3 5\n.....\n#####\n.....", "-1"],
        // Zigzag path
        ["4 4\n...#\n###.\n....\n####", "-1"],
        // Minimal path going right then down
        ["3 4\n....\n###.\n....", "6"],
        // Path exists through narrow corridor
        ["5 5\n.....\n####.\n.....\n.####\n.....", "16"],
        // Large open grid
        ["5 5\n.....\n.....\n.....\n.....\n.....", "8"],
        // Blocked near end
        ["4 4\n....\n....\n....\n..#.", "-1"],
        // U-shaped wall
        ["5 5\n.....\n.###.\n.....\n.###.\n.....", "8"],
        // Narrow winding path
        ["4 5\n....#\n####.\n.....\n#####", "-1"],
        // Diagonal walls — must go around
        ["4 4\n....\n.#..\n..#.\n....", "6"],
      ]
    ),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Creating HOPE Assessment — Level 2...\n");

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
      'HOPE Assessment — Level 2',
      ${'## Instructions\n\n- This is a **2-hour** timed assessment. Your timer starts the moment you open the exam.\n- You may use **C, C++, Python, or Java**.\n- Each problem has **2 visible sample test cases** to help you verify your approach, and **18 hidden test cases** used for grading.\n- Read each problem statement carefully, paying attention to constraints and edge cases.\n- Partial credit is awarded per test case — a correct solution that passes all 20 cases earns full marks.\n- Do **not** refresh the page or navigate away once you start.\n- Good luck!'},
      '2026-10-07 18:00:00+05:30',
      '2026-10-07 22:00:00+05:30',
      120,
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

  console.log(`\n✓ HOPE Assessment — Level 2 ready`);
  console.log(`  Exam ID: ${examId}`);
  console.log(`  Questions: ${questionIds.length}`);
  console.log(`  Window: Oct 7, 2026 — 6:00 PM to 10:00 PM IST`);
  console.log(`  Duration: 120 minutes`);
  console.log(`  Batches: ${HOPE_BATCHES.join(", ")}`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
