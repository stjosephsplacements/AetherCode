/**
 * HOPE Day 3 — Level 2: Shortest Paths
 * Oct 7, 2026 | 6:00 PM – 10:00 PM IST | 120 minutes
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

  // ── Q1: Rotting Oranges ──────────────────────────────────────────────────
  {
    title: "Rotting Oranges",
    statement: `You are given an $R \\times C$ grid representing a box of oranges. Each cell can contain one of three values:

- $0$ — the cell is **empty**
- $1$ — the cell contains a **fresh** orange
- $2$ — the cell contains a **rotten** orange

Every minute, any fresh orange that is **4-directionally adjacent** (up, down, left, right) to a rotten orange becomes rotten.

Return the **minimum number of minutes** that must elapse until no cell has a fresh orange. If it is **impossible** for all oranges to rot, return $-1$.

---

**Input Format**

- First line: two integers $R$ and $C$ — the number of rows and columns $(1 \\le R, C \\le 100)$
- Next $R$ lines: $C$ space-separated integers (each $0$, $1$, or $2$)

**Output Format**

Print a single integer — the minimum number of minutes, or $-1$ if impossible.

---

**Sample Input 1**
\`\`\`
3 3
2 1 1
1 1 0
0 1 1
\`\`\`
**Sample Output 1**
\`\`\`
4
\`\`\`
**Explanation:** The rotten orange at $(0,0)$ spreads outward. Minute 1: $(0,1)$ and $(1,0)$ rot. Minute 2: $(0,2)$ and $(1,1)$ rot. Minute 3: $(2,1)$ rots. Minute 4: $(2,2)$ rots. All fresh oranges are now rotten after 4 minutes.

---

**Sample Input 2**
\`\`\`
3 3
2 1 1
0 1 1
1 0 1
\`\`\`
**Sample Output 2**
\`\`\`
-1
\`\`\`
**Explanation:** The fresh orange at $(2,0)$ can never be reached (blocked by empty cells), so the answer is $-1$.

---

**Constraints**
- $1 \\le R, C \\le 100$
- Each cell is $0$, $1$, or $2$

**Hint:** Use **multi-source BFS**. Start by adding all initially rotten cells to the queue. Process level by level; each level corresponds to one minute. After BFS completes, check if any fresh orange remains.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        // Sample 1: 3x3, answer 4
        ["3 3\n2 1 1\n1 1 0\n0 1 1", "4"],
        // Sample 2: 3x3, unreachable fresh, answer -1
        ["3 3\n2 1 1\n0 1 1\n1 0 1", "-1"],
      ],
      [
        // All rotten already
        ["2 2\n2 2\n2 2", "0"],
        // No oranges at all
        ["2 2\n0 0\n0 0", "0"],
        // Single fresh, no rotten
        ["1 1\n1", "-1"],
        // Single rotten
        ["1 1\n2", "0"],
        // Single fresh adjacent to rotten
        ["1 2\n2 1", "1"],
        // Row of fresh with rotten at left
        ["1 5\n2 1 1 1 1", "4"],
        // Rotten at both ends
        ["1 5\n2 1 1 1 2", "2"],
        // 2x2 one rotten corner
        ["2 2\n2 1\n1 1", "2"],
        // Fresh isolated by empty
        ["3 3\n2 0 1\n0 0 0\n0 0 0", "-1"],
        // Large open grid, rotten center
        ["3 3\n1 1 1\n1 2 1\n1 1 1", "2"],
        // Multiple rotten sources — edges rot min 1, center min 2
        ["3 3\n2 1 2\n1 1 1\n2 1 2", "2"],
        // Only empty and rotten
        ["2 3\n2 0 2\n0 2 0", "0"],
        // L-shaped path
        ["3 3\n2 1 0\n0 1 0\n0 1 1", "4"],
        // Column vector
        ["5 1\n2\n1\n1\n1\n1", "4"],
        // Diagonal unreachable (4-dir only)
        ["2 2\n2 0\n0 1", "-1"],
        // 4x4 rotten top-left, fresh bottom-right
        ["4 4\n2 1 1 1\n0 0 0 1\n0 0 0 1\n0 0 0 1", "6"],
        // All fresh, no rotten
        ["2 2\n1 1\n1 1", "-1"],
        // Wrap-around path through top row and down
        ["2 3\n2 1 1\n0 0 1", "3"],
      ]
    ),
  },

  // ── Q2: Shortest Path in Binary Matrix ───────────────────────────────────
  {
    title: "Shortest Path in Binary Matrix",
    statement: `Given an $N \\times N$ binary grid, find the length of the **shortest clear path** from the **top-left** cell $(0, 0)$ to the **bottom-right** cell $(N-1, N-1)$.

A **clear path** is a path where:
- Every visited cell has value $0$.
- You can move in **8 directions** (up, down, left, right, and 4 diagonals).
- The path starts at $(0, 0)$ and ends at $(N-1, N-1)$.

The **length** of the path is the **number of cells** visited (including start and end).

If there is no clear path, return $-1$.

---

**Input Format**

- First line: an integer $N$ $(1 \\le N \\le 100)$
- Next $N$ lines: $N$ space-separated integers (each $0$ or $1$)

**Output Format**

Print a single integer — the length of the shortest clear path, or $-1$ if no path exists.

---

**Sample Input 1**
\`\`\`
3
0 0 0
1 1 0
1 1 0
\`\`\`
**Sample Output 1**
\`\`\`
4
\`\`\`
**Explanation:** One shortest path: $(0,0) \\to (0,1) \\to (0,2) \\to (1,2) \\to (2,2)$. Wait — that's 5 cells. Actually the shortest is $(0,0) \\to (0,1) \\to (1,2) \\to (2,2)$ using a diagonal, which is 4 cells.

---

**Sample Input 2**
\`\`\`
3
0 1 0
0 1 0
0 0 0
\`\`\`
**Sample Output 2**
\`\`\`
4
\`\`\`
**Explanation:** Path: $(0,0) \\to (1,0) \\to (2,0) \\to (2,1) \\to (2,2)$ is 5 cells. But using diagonal: $(0,0) \\to (1,0) \\to (2,1) \\to (2,2)$ is 4 cells.

---

**Constraints**
- $1 \\le N \\le 100$
- Grid values are $0$ or $1$

**Hint:** Use BFS starting from $(0, 0)$. At each step, explore all 8 neighbors. The first time you reach $(N-1, N-1)$, that is the shortest path length. If $(0,0)$ or $(N-1, N-1)$ is $1$, immediately return $-1$.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        // Sample 1
        ["3\n0 0 0\n1 1 0\n1 1 0", "4"],
        // Sample 2
        ["3\n0 1 0\n0 1 0\n0 0 0", "4"],
      ],
      [
        // 1x1 grid, single 0
        ["1\n0", "1"],
        // 1x1 grid, single 1
        ["1\n1", "-1"],
        // Start blocked
        ["2\n1 0\n0 0", "-1"],
        // End blocked
        ["2\n0 0\n0 1", "-1"],
        // 2x2 all open — diagonal
        ["2\n0 0\n0 0", "2"],
        // 2x2 blocked path
        ["2\n0 1\n1 0", "2"],
        // 3x3 all zeros — diagonal straight
        ["3\n0 0 0\n0 0 0\n0 0 0", "3"],
        // 3x3 only diagonal available
        ["3\n0 1 1\n1 0 1\n1 1 0", "3"],
        // 3x3 completely blocked
        ["3\n0 1 1\n1 1 1\n1 1 0", "-1"],
        // 4x4 direct diagonal
        ["4\n0 0 0 0\n0 0 0 0\n0 0 0 0\n0 0 0 0", "4"],
        // 4x4 diagonal shortcut
        ["4\n0 0 1 1\n1 0 1 1\n1 0 0 0\n1 1 1 0", "4"],
        // 5x5 winding path
        ["5\n0 1 0 0 0\n0 1 0 1 0\n0 0 0 1 0\n1 1 0 1 0\n1 1 0 0 0", "6"],
        // No path — wall across
        ["4\n0 0 0 0\n1 1 1 1\n0 0 0 0\n0 0 0 0", "-1"],
        // Path around wall
        ["4\n0 0 0 0\n1 1 1 0\n0 0 1 0\n0 0 0 0", "6"],
        // Large open 5x5
        ["5\n0 0 0 0 0\n0 0 0 0 0\n0 0 0 0 0\n0 0 0 0 0\n0 0 0 0 0", "5"],
        // Only one path exists
        ["3\n0 0 1\n1 0 1\n1 0 0", "3"],
        // Both corners 0 but middle completely blocked
        ["3\n0 1 1\n1 1 1\n1 1 0", "-1"],
        // 4x4 wall forces detour left then down
        ["4\n0 1 0 0\n0 1 0 0\n0 0 0 1\n0 0 0 0", "5"],
      ]
    ),
  },

  // ── Q3: Network Delay Time ───────────────────────────────────────────────
  {
    title: "Network Delay Time",
    statement: `You are given a network of $N$ nodes (labeled $1$ to $N$) and $M$ **directed weighted edges**. A signal is sent from node $K$.

Return the **minimum time** it takes for **all** $N$ nodes to receive the signal. If it is impossible for all nodes to receive the signal, return $-1$.

The time for the signal to reach a node is the **shortest path distance** from $K$ to that node.

---

**Input Format**

- First line: three integers $N$, $M$, and $K$ — the number of nodes, edges, and the source node
- Next $M$ lines: three integers $u$, $v$, $w$ — a directed edge from $u$ to $v$ with weight $w$

**Output Format**

Print a single integer — the time for all nodes to receive the signal, or $-1$ if not all nodes are reachable.

---

**Sample Input 1**
\`\`\`
4 4 2
2 1 1
2 3 1
3 4 2
1 4 4
\`\`\`
**Sample Output 1**
\`\`\`
3
\`\`\`
**Explanation:** From node $2$: reach node $1$ in time $1$, node $3$ in time $1$, node $4$ via $2 \\to 3 \\to 4$ in time $1 + 2 = 3$. The maximum is $3$.

---

**Sample Input 2**
\`\`\`
3 2 1
1 2 5
2 3 3
\`\`\`
**Sample Output 2**
\`\`\`
8
\`\`\`
**Explanation:** From node $1$: reach node $2$ in $5$, node $3$ in $5 + 3 = 8$. Maximum is $8$.

---

**Constraints**
- $1 \\le N \\le 100$
- $0 \\le M \\le N \\times (N - 1)$
- $1 \\le K \\le N$
- $1 \\le u, v \\le N$; $u \\ne v$
- $1 \\le w \\le 100$
- No duplicate edges (same $u, v$)

**Hint:** Run **Dijkstra's algorithm** from node $K$. After computing the shortest distance to every node, the answer is the **maximum** distance. If any node is unreachable (distance = infinity), return $-1$.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        // Sample 1
        ["4 4 2\n2 1 1\n2 3 1\n3 4 2\n1 4 4", "3"],
        // Sample 2
        ["3 2 1\n1 2 5\n2 3 3", "8"],
      ],
      [
        // Single node, no edges
        ["1 0 1", "0"],
        // Two nodes, one edge
        ["2 1 1\n1 2 10", "10"],
        // Two nodes, edge from source to other
        ["2 1 2\n2 1 3", "3"],
        // Self-contained — all reachable in a cycle
        ["3 3 1\n1 2 1\n2 3 1\n3 1 1", "2"],
        // Star from center
        ["4 3 1\n1 2 2\n1 3 3\n1 4 5", "5"],
        // Chain
        ["5 4 1\n1 2 1\n2 3 1\n3 4 1\n4 5 1", "4"],
        // One node unreachable
        ["4 3 1\n1 2 1\n1 3 2\n2 3 1", "-1"],
        // Shorter path through intermediate
        ["4 5 1\n1 2 10\n1 3 1\n3 2 1\n2 4 1\n3 4 100", "3"],
        // All nodes directly connected from source
        ["4 3 1\n1 2 1\n1 3 1\n1 4 1", "1"],
        // Diamond graph
        ["4 5 1\n1 2 1\n1 3 4\n2 4 2\n3 4 1\n2 3 1", "3"],
        // Reverse chain — only node 1 reachable from 5
        ["5 4 5\n5 4 2\n4 3 2\n3 2 2\n2 1 2", "8"],
        // Two separate components
        ["4 2 1\n1 2 1\n3 4 1", "-1"],
        // Parallel edges different weights (no dup u,v but diff paths)
        ["3 3 1\n1 2 5\n1 3 2\n3 2 1", "3"],
        // Source has no outgoing edges, N > 1
        ["3 2 1\n2 3 1\n3 2 1", "-1"],
        // Large weights
        ["3 2 1\n1 2 100\n2 3 100", "200"],
        // Complete graph of 4
        ["4 12 1\n1 2 3\n1 3 5\n1 4 7\n2 1 3\n2 3 1\n2 4 4\n3 1 5\n3 2 1\n3 4 2\n4 1 7\n4 2 4\n4 3 2", "6"],
        // Multiple shortest paths
        ["4 4 1\n1 2 2\n1 3 2\n2 4 1\n3 4 1", "3"],
        // Only self-loop possible (no outgoing to others)
        ["2 0 1", "-1"],
      ]
    ),
  },

  // ── Q4: Minimum Effort Path ──────────────────────────────────────────────
  {
    title: "Minimum Effort Path",
    statement: `You are given an $R \\times C$ grid of **heights**. You want to travel from the **top-left** cell $(0, 0)$ to the **bottom-right** cell $(R-1, C-1)$.

You can move **4-directionally** (up, down, left, right) to an adjacent cell.

The **effort** of a path is the **maximum absolute difference** in heights between two consecutive cells along the path.

Find the **minimum effort** required to travel from the top-left to the bottom-right.

---

**Input Format**

- First line: two integers $R$ and $C$ $(1 \\le R, C \\le 100)$
- Next $R$ lines: $C$ space-separated integers — the heights $(1 \\le h \\le 10^6)$

**Output Format**

Print a single integer — the minimum effort.

---

**Sample Input 1**
\`\`\`
3 3
1 2 2
3 8 2
5 3 5
\`\`\`
**Sample Output 1**
\`\`\`
2
\`\`\`
**Explanation:** The path $1 \\to 2 \\to 2 \\to 2 \\to 5$ (right, right, down, down) has consecutive differences $|1-2|=1$, $|2-2|=0$, $|2-2|=0$, $|2-5|=3$. Max effort = $3$. But path $(0,0) \\to (0,1) \\to (0,2) \\to (1,2) \\to (2,2)$ gives differences $1, 0, 0, 3$. Actually, path $(0,0) \\to (1,0) \\to (2,0) \\to (2,1) \\to (2,2)$ gives $|1-3|=2$, $|3-5|=2$, $|5-3|=2$, $|3-5|=2$. Max effort = $2$, which is optimal.

---

**Sample Input 2**
\`\`\`
2 2
1 10
10 1
\`\`\`
**Sample Output 2**
\`\`\`
9
\`\`\`
**Explanation:** Any path must cross from $1$ to $10$ (or $10$ to $1$). The minimum max-effort is $9$.

---

**Constraints**
- $1 \\le R, C \\le 100$
- $1 \\le h[i][j] \\le 10^6$

**Hint:** Use **Dijkstra's algorithm** where the "distance" to a cell is the minimum possible maximum-effort to reach it. For each cell, try all 4 neighbors; the new effort is $\\max(\\text{current effort}, |h_{\\text{curr}} - h_{\\text{neighbor}}|)$. Use a min-heap. Alternatively, **binary search** on the answer $e$ and check via BFS/DFS whether a path exists using only edges with $\\le e$ difference.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        // Sample 1
        ["3 3\n1 2 2\n3 8 2\n5 3 5", "2"],
        // Sample 2
        ["2 2\n1 10\n10 1", "9"],
      ],
      [
        // 1x1 grid — no movement needed
        ["1 1\n5", "0"],
        // 1x2 grid
        ["1 2\n1 3", "2"],
        // 2x1 grid
        ["2 1\n1\n5", "4"],
        // All same height
        ["3 3\n5 5 5\n5 5 5\n5 5 5", "0"],
        // Flat row
        ["1 4\n1 1 1 1", "0"],
        // Increasing row
        ["1 4\n1 2 3 4", "1"],
        // Large jump
        ["1 3\n1 1000000 1", "999999"],
        // 2x2 all same
        ["2 2\n3 3\n3 3", "0"],
        // 2x3 minimum step is 2
        ["2 3\n1 3 5\n2 4 6", "2"],
        // 3x3 flat except one spike
        ["3 3\n1 1 1\n1 100 1\n1 1 1", "0"],
        // 3x3 increasing diag
        ["3 3\n1 2 3\n2 3 4\n3 4 5", "1"],
        // Step pattern
        ["3 3\n1 1 2\n1 2 2\n2 2 3", "1"],
        // Only one path (wall forces detour)
        ["3 3\n1 100 1\n1 100 1\n1 1 1", "0"],
        // 2x4 down-then-right path
        ["2 4\n1 2 4 8\n1 3 5 7", "2"],
        // Extreme gradient vertically
        ["3 1\n1\n100\n1", "99"],
        // Checkerboard
        ["2 2\n1 5\n5 1", "4"],
        // 4x1 column
        ["4 1\n10\n20\n15\n25", "10"],
        // Bigger grid minimal effort
        ["4 4\n1 2 1 2\n2 1 2 1\n1 2 1 2\n2 1 2 1", "1"],
      ]
    ),
  },

  // ── Q5: Cheapest Flights Within K Stops ──────────────────────────────────
  {
    title: "Cheapest Flights Within K Stops",
    statement: `There are $N$ cities connected by $M$ flights. Each flight goes from city $u$ to city $v$ with a price $p$.

Given the source city $\\text{src}$, the destination city $\\text{dst}$, and a limit of at most $K$ **stops** (intermediate cities), find the **cheapest price** to get from $\\text{src}$ to $\\text{dst}$ with at most $K$ stops.

If there is no such route, return $-1$.

**Note:** A "stop" is an intermediate city (not counting the source or destination). So $K = 0$ means a direct flight only, $K = 1$ means at most one layover, etc.

---

**Input Format**

- First line: three integers $N$, $M$, $K$ — number of cities, flights, and max stops $(1 \\le N \\le 100$, $0 \\le M \\le N(N-1)$, $0 \\le K \\le N - 2)$
- Second line: two integers $\\text{src}$ and $\\text{dst}$ $(0 \\le \\text{src}, \\text{dst} < N$, $\\text{src} \\ne \\text{dst})$
- Next $M$ lines: three integers $u$, $v$, $p$ — a flight from $u$ to $v$ costing $p$ $(0 \\le u, v < N$, $u \\ne v$, $1 \\le p \\le 10^4)$

**Output Format**

Print a single integer — the cheapest price, or $-1$ if unreachable within $K$ stops.

---

**Sample Input 1**
\`\`\`
4 4 1
0 3
0 1 100
1 2 100
2 3 100
0 3 500
\`\`\`
**Sample Output 1**
\`\`\`
200
\`\`\`
**Explanation:** With $K = 1$ stop, we can go $0 \\to 1 \\to 2 \\to 3$ (2 stops, too many) or $0 \\to 1 \\to ?$ (but no direct $1 \\to 3$). Route $0 \\to 3$ costs $500$ (direct, 0 stops). Route $0 \\to 1 \\to 2 \\to 3$ needs 2 stops. Actually wait — with K=1 the path $0 \\to 1 \\to 3$ doesn't exist. But $0 \\to 3$ direct = $500$. Hmm, re-check: edges are $0 \\to 1$ ($100$), $1 \\to 2$ ($100$), $2 \\to 3$ ($100$), $0 \\to 3$ ($500$). With K=1: allowed paths use at most 2 flights. $0 \\to 3$ direct = $500$. $0 \\to 1 \\to 2$ = $200$ but doesn't reach $3$. $0 \\to 1 \\to 2$ is 1 stop to city $2$, not $3$. Answer: cheapest to reach $3$ with $\\le 1$ stop is $0 \\to 3 = 500$. Wait, but expected output is $200$?

Let me re-read: K=1 means at most 1 stop, so at most 2 edges. Path $0 \\to 1 \\to 2 \\to 3$ has 2 stops (cities $1$ and $2$), which exceeds K=1. So the answer with this graph should be $500$. Let me fix the sample:

With $K = 1$: $0 \\to 1 \\to 3$ doesn't exist. Only route within 1 stop: $0 \\to 3$ = $500$. So the answer is $500$.

Actually, let me use a different example.

With 3 cities, 3 flights, K=1: $0 \\to 1$ costs $100$, $1 \\to 2$ costs $100$, $0 \\to 2$ costs $500$. Source $0$, dest $2$. K=1 allows $0 \\to 1 \\to 2$ = $200$. Answer: $200$.

---

**Sample Input 1**
\`\`\`
3 3 1
0 2
0 1 100
1 2 100
0 2 500
\`\`\`
**Sample Output 1**
\`\`\`
200
\`\`\`
**Explanation:** With $K = 1$ stop, we can use route $0 \\to 1 \\to 2$ with cost $100 + 100 = 200$ (1 stop at city $1$), which is cheaper than the direct flight $0 \\to 2$ at $500$.

---

**Sample Input 2**
\`\`\`
3 3 0
0 2
0 1 100
1 2 100
0 2 500
\`\`\`
**Sample Output 2**
\`\`\`
500
\`\`\`
**Explanation:** With $K = 0$ stops, we can only take a direct flight. $0 \\to 2$ costs $500$. The cheaper route $0 \\to 1 \\to 2$ requires 1 stop, which is not allowed.

---

**Constraints**
- $1 \\le N \\le 100$
- $0 \\le M \\le N(N-1)$
- $0 \\le K \\le N - 2$
- $0 \\le \\text{src}, \\text{dst} < N$; $\\text{src} \\ne \\text{dst}$
- $1 \\le p \\le 10^4$

**Hint:** Use a modified **Bellman-Ford**: run $K + 1$ relaxation rounds. In each round, relax all edges. After $K + 1$ rounds, the distance to $\\text{dst}$ is the answer. Be careful to use a **copy** of the distance array from the previous round when relaxing, to avoid using paths with too many edges in the same round.`,
    time_limit_ms: 2000,
    memory_limit_kb: 262144,
    test_cases: cases(
      [
        // Sample 1: K=1, cheaper via 1 stop
        ["3 3 1\n0 2\n0 1 100\n1 2 100\n0 2 500", "200"],
        // Sample 2: K=0, direct only
        ["3 3 0\n0 2\n0 1 100\n1 2 100\n0 2 500", "500"],
      ],
      [
        // Direct flight only option, K=0
        ["2 1 0\n0 1\n0 1 50", "50"],
        // No flights at all
        ["2 0 0\n0 1", "-1"],
        // K large enough for any path
        ["4 4 3\n0 3\n0 1 10\n1 2 10\n2 3 10\n0 3 100", "30"],
        // K too small — must take expensive direct
        ["4 4 0\n0 3\n0 1 10\n1 2 10\n2 3 10\n0 3 100", "100"],
        // Unreachable destination
        ["3 1 1\n0 2\n0 1 50", "-1"],
        // Chain of 5 cities, K=3 (exactly enough)
        ["5 4 3\n0 4\n0 1 1\n1 2 1\n2 3 1\n3 4 1", "4"],
        // Chain of 5 cities, K=2 (not enough)
        ["5 4 2\n0 4\n0 1 1\n1 2 1\n2 3 1\n3 4 1", "-1"],
        // Two paths: cheap-long vs expensive-short
        ["4 4 1\n0 3\n0 1 1\n1 2 1\n2 3 1\n0 3 50", "50"],
        // Two paths: K=2 allows cheap path
        ["4 4 2\n0 3\n0 1 1\n1 2 1\n2 3 1\n0 3 50", "3"],
        // Triangle
        ["3 3 1\n0 2\n0 1 10\n1 2 10\n0 2 30", "20"],
        // Parallel routes different costs
        ["4 4 1\n0 3\n0 1 5\n1 3 5\n0 2 1\n2 3 1", "2"],
        // Single city with multiple outgoing
        ["4 3 1\n0 3\n0 1 100\n0 2 200\n1 3 50", "150"],
        // Large cost
        ["2 1 0\n0 1\n0 1 10000", "10000"],
        // Multiple hops all cheap
        ["5 4 3\n0 4\n0 1 2\n1 2 2\n2 3 2\n3 4 2", "8"],
        // K=0, no direct flight
        ["3 2 0\n0 2\n0 1 10\n1 2 10", "-1"],
        // Cycle doesn't help
        ["3 4 1\n0 2\n0 1 10\n1 0 10\n1 2 10\n0 2 100", "20"],
        // Same source and intermediate with two routes
        ["4 5 2\n0 3\n0 1 1\n0 2 5\n1 3 100\n2 3 1\n1 2 1", "3"],
        // All cities in a line
        ["3 2 1\n0 2\n0 1 7\n1 2 3", "10"],
      ]
    ),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Creating HOPE Day 3 — Level 2: Shortest Paths...\n");

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
- Questions cover **Shortest Path algorithms**: BFS on grids, Dijkstra's algorithm, and constrained shortest paths.
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
      'HOPE Day 3 — Level 2: Shortest Paths',
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

  console.log(`\n✓ HOPE Day 3 — Level 2: Shortest Paths ready`);
  console.log(`  Exam ID: ${examId}`);
  console.log(`  Questions: ${questionIds.length}`);
  console.log(`  Window: Oct 7, 2026 — 6:00 PM to 10:00 PM IST`);
  console.log(`  Duration: 120 minutes`);
  console.log(`  Batches: ${BATCHES.join(", ")}`);
  console.log(`  Integrity: require_fullscreen + block_external_paste + require_seb`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
