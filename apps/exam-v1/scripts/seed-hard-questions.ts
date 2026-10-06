import { sql } from "../lib/db.js";

function cases(arr: [string, string][]): { input: string; output: string }[] {
  return arr.map(([input, output]) => ({ input, output }));
}

const QUESTIONS: {
  title: string;
  statement: string;
  timeLimitMs: number;
  memoryLimitKb: number;
  tests: { input: string; output: string }[];
}[] = [
  // ── DP ──────────────────────────────────────────────────────────────────────
  {
    title: "Bitmask DP: TSP on Small Graph",
    statement: `You are given a complete directed weighted graph on $n$ vertices $(2 \\le n \\le 20)$.

Find the minimum cost Hamiltonian path that starts at vertex $1$ and visits every vertex exactly once (it does NOT need to return to vertex $1$).

### Input format
Line 1: integer $n$.
Next $n$ lines: $n$ space-separated integers where the $j$-th integer on the $i$-th line is the weight $w_{i,j}$ of the edge from $i$ to $j$ ($1 \\le w_{i,j} \\le 10^4$, $w_{i,i} = 0$).

### Output format
A single integer: the minimum cost of the Hamiltonian path.

### Constraints
- $2 \\le n \\le 20$
- $1 \\le w_{i,j} \\le 10^4$ for $i \\ne j$

### Sample Input 1
\`\`\`
4
0 10 15 20
10 0 35 25
15 35 0 30
20 25 30 0
\`\`\`

### Sample Output 1
\`\`\`
65
\`\`\`

### Explanation
Path $1 \\to 2 \\to 4 \\to 3$: cost $10 + 25 + 30 = 65$.`,
    timeLimitMs: 3000,
    memoryLimitKb: 262144,
    tests: cases([
      ["4\n0 10 15 20\n10 0 35 25\n15 35 0 30\n20 25 30 0", "65"],
      ["2\n0 5\n8 0", "5"],
      ["3\n0 1 100\n100 0 1\n1 100 0", "2"],
      ["3\n0 10 5\n10 0 3\n5 3 0", "8"],
      ["4\n0 1 1 1\n1 0 1 1\n1 1 0 1\n1 1 1 0", "3"],
      ["5\n0 3 6 7 1\n3 0 5 2 7\n6 5 0 4 9\n7 2 4 0 8\n1 7 9 8 0", "14"],
      ["2\n0 100\n1 0", "100"],
      ["3\n0 2 9\n1 0 6\n15 7 0", "8"],
      ["4\n0 2 9 10\n1 0 6 4\n15 7 0 8\n6 3 12 0", "13"],
      ["5\n0 1 2 3 4\n4 0 1 2 3\n3 4 0 1 2\n2 3 4 0 1\n1 2 3 4 0", "4"],
      ["4\n0 4 1 3\n4 0 2 7\n1 2 0 5\n3 7 5 0", "7"],
      ["5\n0 10 8 9 7\n10 0 5 6 4\n8 5 0 3 2\n9 6 3 0 1\n7 4 2 1 0", "10"],
      ["3\n0 100 1\n1 0 100\n100 1 0", "2"],
      ["4\n0 5 5 5\n5 0 5 5\n5 5 0 5\n5 5 5 0", "15"],
      ["5\n0 1 100 100 100\n100 0 1 100 100\n100 100 0 1 100\n100 100 100 0 1\n1 100 100 100 0", "4"],
      ["6\n0 2 9 10 4 8\n2 0 6 3 7 5\n9 6 0 1 8 2\n10 3 1 0 5 7\n4 7 8 5 0 3\n8 5 2 7 3 0", "15"],
      ["4\n0 7 3 12\n7 0 9 2\n3 9 0 6\n12 2 6 0", "12"],
      ["3\n0 999 1\n1 0 999\n999 1 0", "2"],
      ["5\n0 3 1 4 1\n5 0 9 2 6\n5 3 0 5 8\n9 7 9 0 3\n2 3 8 4 0", "9"],
      ["4\n0 1000 1000 1\n1000 0 1 1000\n1000 1 0 1000\n1 1000 1000 0", "2001"],
    ]),
  },
  {
    title: "Digit DP: Count Integers with Digit Sum Divisible by K",
    statement: `Given integers $L$, $R$, and $K$, count the number of integers in $[L, R]$ whose digit sum is divisible by $K$.

### Input format
A single line with three integers $L$, $R$, $K$.

### Output format
A single integer: the count of integers $x$ in $[L, R]$ with $\\text{digitsum}(x) \\equiv 0 \\pmod{K}$.

### Constraints
- $1 \\le L \\le R \\le 10^{18}$
- $1 \\le K \\le 100$

### Sample Input 1
\`\`\`
1 20 3
\`\`\`

### Sample Output 1
\`\`\`
7
\`\`\`

### Explanation
Numbers: $3, 6, 9, 12, 15, 18, 20$? Wait — $\\text{digitsum}(20) = 2$, not divisible by 3.
Valid: $3, 6, 9, 12, 15, 18$ → 6 numbers. Actually also check $1..20$: those with digit sum $\\% 3 = 0$ are $3,6,9,12,15,18$ → **6**.`,
    timeLimitMs: 2000,
    memoryLimitKb: 131072,
    tests: cases([
      ["1 20 3", "6"],
      ["1 100 7", "15"],
      ["1 1000000000000000000 1", "1000000000000000000"],
      ["1 9 5", "1"],
      ["10 99 9", "10"],
      ["1 1 1", "1"],
      ["100 200 11", "10"],
      ["1 1000 3", "334"],
      ["1000000000000000000 1000000000000000000 9", "0"],
      ["999999999999999999 1000000000000000000 9", "1"],
      ["1 1000000000 5", "200000000"],
      ["1 100 10", "9"],
      ["50 150 7", "15"],
      ["1 10 10", "0"],
      ["10 10 1", "1"],
      ["1 99 9", "10"],
      ["1 9 9", "1"],
      ["1 18 9", "3"],
      ["100 999 4", "225"],
      ["1 1000000000000000000 100", "10000000000000000"],
    ]),
  },
  {
    title: "Interval DP: Minimum Cost to Merge Stones",
    statement: `There are $n$ piles of stones in a row. The $i$-th pile has $a_i$ stones. On each move you may merge any two **adjacent** piles. The cost of merging two piles of sizes $x$ and $y$ is $x + y$. Find the minimum total cost to merge all piles into one.

### Input format
Line 1: integer $n$.
Line 2: $n$ space-separated integers $a_1, a_2, \\ldots, a_n$.

### Output format
A single integer: the minimum total cost.

### Constraints
- $2 \\le n \\le 500$
- $1 \\le a_i \\le 10^4$

### Sample Input 1
\`\`\`
4
3 5 4 2
\`\`\`

### Sample Output 1
\`\`\`
26
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 131072,
    tests: cases([
      ["4\n3 5 4 2", "26"],
      ["2\n1 1", "2"],
      ["3\n1 2 3", "9"],
      ["5\n1 1 1 1 1", "8"],
      ["4\n10 10 10 10", "80"],
      ["3\n100 1 100", "201"],
      ["5\n5 3 8 2 7", "64"],
      ["2\n10000 10000", "20000"],
      ["4\n1 2 3 4", "19"],
      ["6\n1 1 1 1 1 1", "15"],
      ["3\n5 5 5", "25"],
      ["4\n1 5 1 5", "24"],
      ["5\n10 20 30 40 50", "330"],
      ["3\n1 1 100", "103"],
      ["4\n1 1 1 100", "106"],
      ["5\n1 2 3 4 5", "33"],
      ["6\n3 1 4 1 5 9", "61"],
      ["4\n100 1 1 100", "204"],
      ["3\n1000 2000 3000", "9000"],
      ["5\n1 3 5 7 9", "65"],
    ]),
  },
  {
    title: "Tree DP: Maximum Independent Set on Tree",
    statement: `Given a tree with $n$ nodes rooted at node $1$, each node $i$ has a weight $w_i$. Find the maximum weight independent set — a set $S$ of nodes such that no two nodes in $S$ are adjacent (connected by an edge), and $\\sum_{i \\in S} w_i$ is maximized.

### Input format
Line 1: integer $n$.
Line 2: $n$ space-separated integers $w_1, w_2, \\ldots, w_n$.
Next $n-1$ lines: two integers $u$ $v$ describing an edge.

### Output format
A single integer: the maximum weight independent set value.

### Constraints
- $1 \\le n \\le 3 \\times 10^5$
- $1 \\le w_i \\le 10^9$

### Sample Input 1
\`\`\`
5
3 5 4 2 1
1 2
1 3
3 4
3 5
\`\`\`

### Sample Output 1
\`\`\`
11
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 262144,
    tests: cases([
      ["5\n3 5 4 2 1\n1 2\n1 3\n3 4\n3 5", "11"],
      ["1\n10", "10"],
      ["2\n5 3\n1 2", "5"],
      ["3\n1 100 1\n1 2\n2 3", "100"],
      ["4\n1 2 3 4\n1 2\n2 3\n3 4", "7"],
      ["5\n1 1 1 1 1\n1 2\n2 3\n3 4\n4 5", "3"],
      ["4\n10 1 1 10\n1 2\n1 3\n1 4", "21"],
      ["6\n2 3 4 5 6 7\n1 2\n1 3\n2 4\n2 5\n3 6", "18"],
      ["3\n100 1 100\n1 2\n1 3", "200"],
      ["7\n1 2 3 4 5 6 7\n1 2\n1 3\n2 4\n2 5\n3 6\n3 7", "27"],
      ["4\n5 5 5 5\n1 2\n2 3\n2 4", "15"],
      ["5\n10 9 8 7 6\n1 2\n2 3\n3 4\n4 5", "28"],
      ["6\n1 2 3 4 5 6\n1 2\n1 3\n1 4\n1 5\n1 6", "20"],
      ["4\n1000000000 1000000000 1000000000 1000000000\n1 2\n1 3\n1 4", "3000000000"],
      ["3\n1 2 3\n1 2\n1 3", "4"],
      ["5\n5 4 3 2 1\n1 2\n1 3\n3 4\n3 5", "11"],
      ["6\n3 5 2 8 1 4\n1 2\n1 3\n2 4\n3 5\n3 6", "20"],
      ["4\n1 10 10 1\n1 2\n2 3\n3 4", "20"],
      ["5\n7 3 7 3 7\n1 2\n2 3\n3 4\n4 5", "21"],
      ["6\n1 2 3 4 5 6\n1 2\n2 3\n3 4\n4 5\n5 6", "12"],
    ]),
  },
  {
    title: "DAG DP: Longest Path in DAG",
    statement: `Given a Directed Acyclic Graph (DAG) with $n$ nodes and $m$ edges, each node has a value $v_i$. Find the maximum sum of node values along any path (a path visits each node at most once and follows edge directions). The path must have at least one node.

### Input format
Line 1: two integers $n$ and $m$.
Line 2: $n$ space-separated integers $v_1, \\ldots, v_n$.
Next $m$ lines: two integers $u$ $w$ describing a directed edge from $u$ to $w$.

### Output format
A single integer: the maximum path sum.

### Constraints
- $1 \\le n \\le 10^5$
- $0 \\le m \\le 2 \\times 10^5$
- $-10^9 \\le v_i \\le 10^9$

### Sample Input 1
\`\`\`
5 6
1 2 3 4 5
1 2
1 3
2 4
3 4
4 5
2 5
\`\`\`

### Sample Output 1
\`\`\`
15
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 262144,
    tests: cases([
      ["5 6\n1 2 3 4 5\n1 2\n1 3\n2 4\n3 4\n4 5\n2 5", "15"],
      ["1 0\n42", "42"],
      ["2 1\n-1 5\n1 2", "4"],
      ["3 2\n1 2 3\n1 2\n2 3", "6"],
      ["4 0\n-5 -3 -1 -2", "-1"],
      ["3 0\n1 2 3", "3"],
      ["4 4\n1 -10 3 5\n1 2\n1 3\n3 4\n2 4", "9"],
      ["5 4\n3 1 4 1 5\n1 2\n2 3\n3 4\n4 5", "14"],
      ["3 3\n100 -50 100\n1 2\n2 3\n1 3", "200"],
      ["4 3\n1 2 3 4\n1 2\n2 3\n3 4", "10"],
      ["5 0\n-1 -2 -3 -4 -5", "-1"],
      ["6 5\n5 4 3 2 1 6\n1 2\n2 3\n3 4\n4 5\n5 6", "21"],
      ["4 6\n1 1 1 1\n1 2\n1 3\n1 4\n2 4\n3 4\n2 3", "4"],
      ["5 5\n10 -5 10 -5 10\n1 2\n2 3\n3 4\n4 5\n1 3", "30"],
      ["3 1\n-10 -20 100\n1 3", "90"],
      ["6 7\n2 3 1 5 4 6\n1 2\n1 3\n2 4\n3 4\n4 5\n4 6\n5 6", "21"],
      ["5 6\n1 2 3 4 5\n1 2\n1 3\n2 5\n3 5\n4 5\n1 4", "12"],
      ["4 3\n-1 -1 -1 100\n1 4\n2 4\n3 4", "99"],
      ["6 6\n3 7 2 8 1 9\n1 2\n1 3\n2 4\n3 5\n4 6\n5 6", "27"],
      ["5 4\n1 100 1 100 1\n1 2\n2 3\n3 4\n4 5", "203"],
    ]),
  },
  {
    title: "Counting DP: Number of Ways to Partition into K Non-empty Subsets",
    statement: `Given $n$ and $k$, compute the Stirling number of the second kind $S(n,k)$: the number of ways to partition a set of $n$ elements into exactly $k$ non-empty, unordered subsets.

Since the answer can be huge, output it modulo $10^9 + 7$.

### Input format
Two integers $n$ and $k$ on a single line.

### Output format
$S(n,k) \\bmod (10^9+7)$.

### Constraints
- $1 \\le k \\le n \\le 1000$

### Sample Input 1
\`\`\`
4 2
\`\`\`

### Sample Output 1
\`\`\`
7
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 131072,
    tests: cases([
      ["4 2", "7"],
      ["1 1", "1"],
      ["2 1", "1"],
      ["2 2", "1"],
      ["3 2", "3"],
      ["4 4", "1"],
      ["5 3", "25"],
      ["10 5", "42525"],
      ["10 1", "1"],
      ["10 10", "1"],
      ["100 50", "396447076"],
      ["1000 1", "1"],
      ["1000 1000", "1"],
      ["6 3", "90"],
      ["7 4", "350"],
      ["8 2", "127"],
      ["15 7", "420693273"],
      ["20 10", "430568024"],
      ["50 25", "591250530"],
      ["500 250", "754013836"],
    ]),
  },
  // ── ARRAYS ──────────────────────────────────────────────────────────────────
  {
    title: "Inversions via Merge Sort",
    statement: `Given an array $a_1, a_2, \\ldots, a_n$ of distinct integers, count the number of **inversions**: pairs $(i, j)$ with $i < j$ and $a_i > a_j$.

### Input format
Line 1: integer $n$.
Line 2: $n$ space-separated integers.

### Output format
A single integer: the inversion count.

### Constraints
- $1 \\le n \\le 5 \\times 10^5$
- $|a_i| \\le 10^9$, all $a_i$ distinct

### Sample Input 1
\`\`\`
5
5 4 3 2 1
\`\`\`

### Sample Output 1
\`\`\`
10
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 131072,
    tests: cases([
      ["5\n5 4 3 2 1", "10"],
      ["1\n42", "0"],
      ["2\n1 2", "0"],
      ["2\n2 1", "1"],
      ["4\n1 3 2 4", "1"],
      ["5\n1 2 3 4 5", "0"],
      ["6\n3 1 4 1 5 9", "2"],
      ["4\n4 3 2 1", "6"],
      ["5\n2 4 1 3 5", "3"],
      ["6\n6 5 4 3 2 1", "15"],
      ["7\n1 7 2 6 3 5 4", "8"],
      ["4\n1 2 3 4", "0"],
      ["5\n5 1 2 3 4", "4"],
      ["6\n2 1 4 3 6 5", "3"],
      ["8\n8 7 6 5 4 3 2 1", "28"],
      ["5\n3 5 1 4 2", "5"],
      ["6\n1 3 5 2 4 6", "3"],
      ["7\n7 1 2 3 4 5 6", "6"],
      ["8\n1 2 8 4 5 3 7 6", "5"],
      ["6\n5 3 1 6 4 2", "9"],
    ]),
  },
  {
    title: "Subarray with Maximum XOR",
    statement: `Given an array $a_1, \\ldots, a_n$ of non-negative integers, find the maximum XOR value among all **contiguous** subarrays (including single elements).

### Input format
Line 1: integer $n$.
Line 2: $n$ space-separated non-negative integers.

### Output format
A single integer: the maximum subarray XOR.

### Constraints
- $1 \\le n \\le 4 \\times 10^5$
- $0 \\le a_i \\le 10^9$

### Sample Input 1
\`\`\`
6
3 10 5 25 2 8
\`\`\`

### Sample Output 1
\`\`\`
28
\`\`\`

### Hint
Use prefix XOR array $P_0 = 0$, $P_i = a_1 \\oplus \\cdots \\oplus a_i$. Answer is $\\max_{i < j} P_i \\oplus P_j$, solvable with a trie in $O(n \\log \\text{MAX})$.`,
    timeLimitMs: 2000,
    memoryLimitKb: 262144,
    tests: cases([
      ["6\n3 10 5 25 2 8", "28"],
      ["1\n0", "0"],
      ["1\n7", "7"],
      ["2\n1 2", "3"],
      ["3\n1 2 3", "3"],
      ["5\n4 6 7 8 9", "15"],
      ["4\n8 1 2 12", "15"],
      ["5\n0 0 0 0 0", "0"],
      ["4\n1 1 1 1", "1"],
      ["3\n15 14 13", "15"],
      ["6\n2 4 8 16 32 64", "126"],
      ["5\n1000000000 1000000000 1 1 1000000000", "1000000001"],
      ["4\n5 4 3 2", "7"],
      ["5\n7 7 7 7 7", "7"],
      ["6\n0 1 2 3 4 5", "7"],
      ["3\n3 5 6", "7"],
      ["7\n1 3 5 7 9 11 13", "15"],
      ["4\n100 200 300 400", "511"],
      ["5\n1 0 1 0 1", "1"],
      ["6\n10 20 30 40 50 60", "63"],
    ]),
  },
  {
    title: "Median Maintenance: Online Median of Stream",
    statement: `You receive $n$ integers one by one. After each integer, output the median of all integers seen so far. If the count is even, output the smaller of the two middle values.

### Input format
Line 1: integer $n$.
Line 2: $n$ space-separated integers.

### Output format
$n$ space-separated integers: the running medians.

### Constraints
- $1 \\le n \\le 5 \\times 10^5$
- $1 \\le a_i \\le 10^9$

### Sample Input 1
\`\`\`
6
5 15 1 3 2 8
\`\`\`

### Sample Output 1
\`\`\`
5 5 5 3 3 4
\`\`\`

Wait — the problem says output the smaller of two middles. Recheck: after $[5,15]$ → $5$; after $[1,5,15]$ → $5$; after $[1,3,5,15]$ → $3$ (two middles $3,5$ → smaller is $3$); after $[1,2,3,5,15]$ → $3$; after $[1,2,3,5,8,15]$ → $3$ (middles $3,5$ → $3$). So output: **5 5 5 3 3 3**.`,
    timeLimitMs: 3000,
    memoryLimitKb: 262144,
    tests: cases([
      ["6\n5 15 1 3 2 8", "5 5 5 3 3 3"],
      ["1\n1", "1"],
      ["2\n1 2", "1"],
      ["3\n3 1 2", "3 1 2"],
      ["4\n1 2 3 4", "1 1 2 2"],
      ["5\n5 4 3 2 1", "5 4 4 3 3"],
      ["5\n1 1 1 1 1", "1 1 1 1 1"],
      ["4\n10 5 15 20", "10 5 10 10"],
      ["6\n1 2 3 4 5 6", "1 1 2 2 3 3"],
      ["3\n100 1 50", "100 1 50"],
      ["4\n4 4 4 4", "4 4 4 4"],
      ["5\n9 8 7 6 5", "9 8 8 7 7"],
      ["7\n3 1 4 1 5 9 2", "3 1 3 1 3 4 3"],
      ["6\n2 7 4 1 8 1", "2 2 4 3 4 3"],
      ["4\n1000000000 1 1000000000 1", "1000000000 1 1000000000 1"],
      ["5\n5 3 8 2 7", "5 3 5 3 5"],
      ["8\n1 2 3 4 5 6 7 8", "1 1 2 2 3 3 4 4"],
      ["4\n3 3 3 3", "3 3 3 3"],
      ["5\n10 3 7 1 9", "10 3 7 3 7"],
      ["6\n6 5 4 3 2 1", "6 5 5 4 4 3"],
    ]),
  },
  {
    title: "Prefix Sum Mod: Count Subarrays Divisible by P",
    statement: `Given an array $a_1, \\ldots, a_n$ and integer $p$, count the number of contiguous subarrays whose sum is divisible by $p$.

### Input format
Two integers $n$ and $p$, then $n$ space-separated integers $a_i$.

### Output format
A single integer: the count.

### Constraints
- $1 \\le n \\le 3 \\times 10^5$
- $2 \\le p \\le 10^9$
- $0 \\le a_i \\le 10^9$

### Sample Input 1
\`\`\`
6 5
4 5 0 -2 -3 1
\`\`\`

### Sample Output 1
\`\`\`
7
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 131072,
    tests: cases([
      ["6 5\n4 5 0 -2 -3 1", "7"],
      ["3 3\n3 6 9", "6"],
      ["1 5\n5", "1"],
      ["1 5\n3", "0"],
      ["4 2\n1 2 3 4", "4"],
      ["5 1\n1 2 3 4 5", "15"],
      ["4 10\n10 10 10 10", "10"],
      ["3 7\n7 7 7", "6"],
      ["5 3\n1 2 3 4 5", "4"],
      ["6 4\n4 0 4 0 4 0", "9"],
      ["4 5\n1 2 3 4", "0"],
      ["5 2\n2 4 6 8 10", "15"],
      ["3 100\n100 200 300", "6"],
      ["4 3\n0 0 0 0", "10"],
      ["6 6\n6 6 6 6 6 6", "21"],
      ["5 5\n5 10 15 20 25", "15"],
      ["3 2\n1 3 5", "3"],
      ["4 7\n7 14 21 28", "10"],
      ["5 4\n1 3 5 7 9", "3"],
      ["6 3\n1 1 1 1 1 1", "6"],
    ]),
  },
  // ── GRAPHS ──────────────────────────────────────────────────────────────────
  {
    title: "SCC and Condensation DAG",
    statement: `Given a directed graph with $n$ nodes and $m$ edges, find the number of **Strongly Connected Components** (SCCs), and report the condensation DAG. Print the number of SCCs and the number of edges in the condensation DAG.

### Input format
Line 1: two integers $n$ and $m$.
Next $m$ lines: two integers $u$ $v$ for a directed edge $u \\to v$.

### Output format
Two integers on one line: the number of SCCs, then the number of edges in the condensation DAG (no duplicate edges in condensation).

### Constraints
- $1 \\le n \\le 10^5$
- $0 \\le m \\le 2 \\times 10^5$

### Sample Input 1
\`\`\`
8 9
1 2
2 3
3 1
4 5
5 6
6 4
7 8
3 4
6 7
\`\`\`

### Sample Output 1
\`\`\`
3 2
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 262144,
    tests: cases([
      ["8 9\n1 2\n2 3\n3 1\n4 5\n5 6\n6 4\n7 8\n3 4\n6 7", "3 2"],
      ["3 3\n1 2\n2 3\n3 1", "1 0"],
      ["4 4\n1 2\n2 3\n3 4\n4 1", "1 0"],
      ["4 0", "4 0"],
      ["4 4\n1 2\n2 1\n3 4\n4 3", "2 0"],
      ["5 5\n1 2\n2 3\n3 1\n4 5\n5 4", "2 0"],
      ["4 3\n1 2\n2 3\n3 4", "4 3"],
      ["6 7\n1 2\n2 3\n3 1\n4 5\n5 6\n6 4\n3 4", "2 1"],
      ["5 6\n1 2\n2 3\n3 1\n1 4\n4 5\n5 1", "1 0"],
      ["6 6\n1 2\n2 1\n3 4\n4 3\n5 6\n6 5", "3 0"],
      ["7 8\n1 2\n2 3\n3 1\n4 5\n5 4\n6 7\n1 4\n4 6", "3 2"],
      ["5 4\n1 2\n3 4\n5 1\n2 5", "3 1"],
      ["4 4\n1 2\n2 3\n3 1\n4 1", "2 1"],
      ["6 8\n1 2\n2 1\n3 4\n4 5\n5 3\n1 3\n2 4\n5 6", "3 3"],
      ["3 0", "3 0"],
      ["5 8\n1 2\n2 3\n3 1\n1 4\n4 5\n5 1\n2 4\n3 5", "1 0"],
      ["6 6\n1 2\n2 3\n3 1\n4 5\n5 6\n6 4", "2 0"],
      ["7 7\n1 2\n2 3\n3 1\n4 5\n5 6\n6 4\n3 4", "2 1"],
      ["4 5\n1 2\n2 3\n3 4\n4 2\n1 4", "2 2"],
      ["5 5\n1 2\n2 3\n3 4\n4 5\n5 3", "2 1"],
    ]),
  },
  {
    title: "Eulerian Path in Directed Graph",
    statement: `Given a directed graph, determine if an **Eulerian path** (traverses every edge exactly once) exists. If yes, output the path as a sequence of nodes; otherwise output $-1$.

An Eulerian path exists iff the graph is connected (considering only edges) and exactly one node has $\\text{out} - \\text{in} = 1$ (start), one has $\\text{in} - \\text{out} = 1$ (end), and all others have equal in/out degrees. If an Eulerian **circuit** exists (all equal), start from node $1$.

### Input format
Line 1: two integers $n$ and $m$.
Next $m$ lines: two integers $u$ $v$.

### Output format
The sequence of $m+1$ node indices on one line, or $-1$.

### Constraints
- $1 \\le n \\le 10^5$
- $1 \\le m \\le 2 \\times 10^5$

### Sample Input 1
\`\`\`
4 4
1 2
2 3
3 4
4 2
\`\`\`

### Sample Output 1
\`\`\`
1 2 3 4 2
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 262144,
    tests: cases([
      ["4 4\n1 2\n2 3\n3 4\n4 2", "1 2 3 4 2"],
      ["3 3\n1 2\n2 3\n3 1", "1 2 3 1"],
      ["2 2\n1 2\n2 1", "1 2 1"],
      ["4 4\n1 2\n1 3\n2 4\n3 4", "-1"],
      ["3 2\n1 2\n2 3", "1 2 3"],
      ["4 5\n1 2\n2 3\n3 4\n4 2\n2 1", "-1"],
      ["5 5\n1 2\n2 3\n3 4\n4 5\n5 1", "1 2 3 4 5 1"],
      ["4 6\n1 2\n2 3\n3 1\n1 4\n4 3\n3 2", "-1"],
      ["3 3\n1 2\n2 1\n1 2", "-1"],
      ["4 4\n1 2\n2 4\n1 3\n3 4", "1 2 4 0"],
      ["2 1\n1 2", "1 2"],
      ["5 6\n1 2\n2 3\n3 4\n4 5\n5 2\n2 1", "-1"],
      ["4 4\n2 3\n3 4\n4 2\n1 2", "1 2 3 4 2"],
      ["3 4\n1 2\n2 3\n3 1\n1 2", "-1"],
      ["5 5\n1 2\n2 3\n3 1\n3 4\n4 5", "-1"],
      ["4 5\n1 2\n2 3\n3 1\n1 4\n4 1", "1 2 3 1 4 1"],
      ["3 3\n1 2\n2 1\n2 3", "-1"],
      ["6 6\n1 2\n2 3\n3 4\n4 5\n5 6\n6 1", "1 2 3 4 5 6 1"],
      ["5 6\n1 2\n2 3\n3 4\n4 5\n5 3\n3 1", "1 2 3 4 5 3 1"],
      ["4 4\n1 2\n2 3\n3 4\n4 1", "1 2 3 4 1"],
    ]),
  },
  {
    title: "Bipartite Matching: Maximum Matching",
    statement: `Given a bipartite graph with $L$ left nodes, $R$ right nodes, and $m$ edges, find the size of the **maximum matching**.

### Input format
Line 1: three integers $L$, $R$, $m$.
Next $m$ lines: two integers $u$ $v$ ($1 \\le u \\le L$, $1 \\le v \\le R$), edge between left node $u$ and right node $v$.

### Output format
A single integer: the maximum matching size.

### Constraints
- $1 \\le L, R \\le 500$
- $0 \\le m \\le L \\times R$

### Sample Input 1
\`\`\`
3 3 4
1 2
1 3
2 1
3 3
\`\`\`

### Sample Output 1
\`\`\`
3
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 131072,
    tests: cases([
      ["3 3 4\n1 2\n1 3\n2 1\n3 3", "3"],
      ["1 1 0", "0"],
      ["1 1 1\n1 1", "1"],
      ["2 2 1\n1 1", "1"],
      ["3 3 9\n1 1\n1 2\n1 3\n2 1\n2 2\n2 3\n3 1\n3 2\n3 3", "3"],
      ["4 4 4\n1 1\n2 2\n3 3\n4 4", "4"],
      ["3 3 3\n1 1\n1 2\n1 3", "1"],
      ["4 3 6\n1 1\n1 2\n2 2\n2 3\n3 1\n4 3", "3"],
      ["5 5 0", "0"],
      ["3 3 5\n1 1\n1 2\n2 2\n2 3\n3 1", "3"],
      ["2 3 4\n1 1\n1 2\n2 2\n2 3", "2"],
      ["4 4 8\n1 2\n1 3\n2 1\n2 3\n3 2\n3 4\n4 1\n4 4", "4"],
      ["3 4 6\n1 1\n1 4\n2 2\n2 4\n3 3\n3 4", "3"],
      ["5 5 5\n1 1\n2 2\n3 3\n4 4\n5 5", "5"],
      ["2 2 2\n1 2\n2 1", "2"],
      ["4 3 7\n1 1\n1 2\n2 1\n2 3\n3 2\n3 3\n4 1", "3"],
      ["5 5 10\n1 1\n1 2\n2 2\n2 3\n3 3\n3 4\n4 4\n4 5\n5 5\n5 1", "5"],
      ["3 3 6\n1 1\n1 2\n2 1\n2 2\n3 1\n3 2", "2"],
      ["4 4 7\n1 1\n2 1\n2 2\n3 2\n3 3\n4 3\n4 4", "4"],
      ["3 3 0", "0"],
    ]),
  },
  {
    title: "Bridges and Articulation Points",
    statement: `Given an undirected connected graph with $n$ nodes and $m$ edges, find the number of **bridges** (edges whose removal disconnects the graph) and the number of **articulation points** (nodes whose removal disconnects the graph).

### Input format
Line 1: two integers $n$ and $m$.
Next $m$ lines: two integers $u$ $v$.

### Output format
Two integers: the number of bridges, then the number of articulation points.

### Constraints
- $2 \\le n \\le 10^5$
- $1 \\le m \\le 2 \\times 10^5$
- No self-loops, no multi-edges

### Sample Input 1
\`\`\`
7 8
1 2
1 3
2 3
3 4
4 5
4 6
5 6
6 7
\`\`\`

### Sample Output 1
\`\`\`
2 2
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 262144,
    tests: cases([
      ["7 8\n1 2\n1 3\n2 3\n3 4\n4 5\n4 6\n5 6\n6 7", "2 2"],
      ["2 1\n1 2", "1 0"],
      ["3 3\n1 2\n2 3\n3 1", "0 0"],
      ["4 3\n1 2\n2 3\n3 4", "3 2"],
      ["4 4\n1 2\n2 3\n3 4\n4 1", "0 0"],
      ["5 5\n1 2\n2 3\n3 1\n3 4\n4 5", "2 2"],
      ["6 6\n1 2\n2 3\n3 1\n3 4\n4 5\n5 6", "3 2"],
      ["4 5\n1 2\n1 3\n2 3\n1 4\n2 4", "0 0"],
      ["6 7\n1 2\n2 3\n3 1\n3 4\n4 5\n5 6\n6 4", "1 1"],
      ["5 4\n1 2\n2 3\n3 4\n4 5", "4 3"],
      ["5 6\n1 2\n2 3\n3 4\n4 5\n5 1\n1 3", "0 0"],
      ["7 7\n1 2\n2 3\n3 1\n3 4\n4 5\n5 6\n6 4", "1 1"],
      ["6 5\n1 2\n2 3\n3 4\n4 5\n5 6", "5 4"],
      ["4 4\n1 2\n2 3\n3 1\n2 4", "1 1"],
      ["6 9\n1 2\n2 3\n3 1\n4 5\n5 6\n6 4\n1 4\n2 5\n3 6", "0 0"],
      ["5 5\n1 2\n2 3\n3 1\n1 4\n4 5", "2 2"],
      ["7 9\n1 2\n2 3\n3 1\n4 5\n5 6\n6 7\n7 4\n3 4\n1 5", "0 0"],
      ["5 4\n1 2\n1 3\n1 4\n1 5", "4 1"],
      ["6 7\n1 2\n2 3\n3 4\n4 2\n4 5\n5 6\n6 4", "1 1"],
      ["8 9\n1 2\n2 3\n3 1\n3 4\n4 5\n5 6\n6 4\n6 7\n7 8", "2 2"],
    ]),
  },
  {
    title: "0-1 BFS: Shortest Path with 0 or 1 Edge Weights",
    statement: `Given a graph with $n$ nodes and $m$ directed edges, each edge has weight either $0$ or $1$. Find the shortest path (by total edge weight) from node $1$ to node $n$.

Use 0-1 BFS (deque): push 0-weight edges to front, 1-weight edges to back.

### Input format
Line 1: two integers $n$ and $m$.
Next $m$ lines: three integers $u$ $v$ $w$ ($w \\in \\{0, 1\\}$).

### Output format
The minimum distance from $1$ to $n$, or $-1$ if unreachable.

### Constraints
- $1 \\le n \\le 10^5$
- $0 \\le m \\le 3 \\times 10^5$

### Sample Input 1
\`\`\`
5 7
1 2 0
1 3 1
2 3 0
3 4 1
2 4 1
3 5 0
4 5 0
\`\`\`

### Sample Output 1
\`\`\`
1
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 262144,
    tests: cases([
      ["5 7\n1 2 0\n1 3 1\n2 3 0\n3 4 1\n2 4 1\n3 5 0\n4 5 0", "1"],
      ["2 1\n1 2 1", "1"],
      ["2 1\n1 2 0", "0"],
      ["3 2\n1 2 1\n2 3 1", "2"],
      ["3 3\n1 2 0\n2 3 0\n1 3 1", "0"],
      ["4 4\n1 2 0\n2 3 0\n3 4 0\n1 4 1", "0"],
      ["4 4\n1 2 1\n2 3 1\n3 4 1\n1 4 0", "0"],
      ["5 4\n1 2 1\n2 3 1\n3 4 1\n4 5 1", "4"],
      ["5 4\n1 2 0\n2 3 0\n3 4 0\n4 5 0", "0"],
      ["3 0", "-1"],
      ["4 5\n1 2 1\n1 3 0\n3 2 0\n2 4 1\n3 4 1", "1"],
      ["6 6\n1 2 0\n2 3 1\n3 4 0\n4 5 1\n5 6 0\n1 6 1", "1"],
      ["5 5\n1 2 1\n2 3 0\n3 4 1\n4 5 0\n1 5 1", "1"],
      ["4 3\n1 2 1\n2 3 0\n3 4 1", "2"],
      ["6 8\n1 2 0\n1 3 1\n2 4 0\n3 4 0\n4 5 1\n5 6 0\n2 5 1\n3 6 1", "1"],
      ["5 6\n1 2 1\n1 3 0\n2 4 1\n3 4 1\n4 5 0\n3 5 1", "1"],
      ["5 0", "-1"],
      ["4 4\n1 2 0\n2 3 0\n1 3 1\n3 4 0", "0"],
      ["6 7\n1 2 1\n2 3 0\n3 4 1\n4 5 0\n5 6 1\n1 4 1\n4 6 0", "1"],
      ["5 5\n1 2 0\n2 3 0\n3 4 0\n4 5 1\n1 5 1", "1"],
    ]),
  },
  {
    title: "Floyd-Warshall: All-Pairs Shortest Paths",
    statement: `Given a directed weighted graph on $n$ nodes, find the shortest path between every pair of nodes using Floyd-Warshall.

Output the $n \\times n$ distance matrix. Use $10^9$ to denote infinity (unreachable). If any negative cycle exists, output $-1$.

### Input format
Line 1: two integers $n$ and $m$.
Next $m$ lines: three integers $u$, $v$, $w$ (directed edge, $|w| \\le 10^5$).

### Output format
$n$ lines of $n$ space-separated values (or $-1$ for negative cycle).

### Constraints
- $1 \\le n \\le 300$
- $0 \\le m \\le n^2$

### Sample Input 1
\`\`\`
3 4
1 2 3
1 3 8
2 3 2
3 1 -5
\`\`\`

### Sample Output 1
\`\`\`
-1
\`\`\``,
    timeLimitMs: 3000,
    memoryLimitKb: 131072,
    tests: cases([
      ["3 4\n1 2 3\n1 3 8\n2 3 2\n3 1 -5", "-1"],
      ["3 3\n1 2 1\n2 3 1\n1 3 5", "0 1 2\n1000000000 0 1\n1000000000 1000000000 0"],
      ["2 2\n1 2 5\n2 1 10", "0 5\n10 0"],
      ["4 0", "0 1000000000 1000000000 1000000000\n1000000000 0 1000000000 1000000000\n1000000000 1000000000 0 1000000000\n1000000000 1000000000 1000000000 0"],
      ["3 3\n1 2 2\n2 3 3\n3 1 4", "0 2 5\n7 0 3\n4 6 0"],
      ["2 1\n1 2 -3", "0 -3\n1000000000 0"],
      ["3 3\n1 2 1\n2 3 1\n3 2 -3", "-1"],
      ["4 5\n1 2 3\n1 3 8\n2 3 2\n2 4 7\n3 4 1", "0 3 5 6\n1000000000 0 2 3\n1000000000 1000000000 0 1\n1000000000 1000000000 1000000000 0"],
      ["2 0", "0 1000000000\n1000000000 0"],
      ["3 6\n1 2 1\n2 1 1\n2 3 1\n3 2 1\n1 3 1\n3 1 1", "0 1 1\n1 0 1\n1 1 0"],
      ["4 4\n1 2 1\n2 3 1\n3 4 1\n4 1 1", "0 1 2 3\n3 0 1 2\n2 3 0 1\n1 2 3 0"],
      ["4 4\n1 2 1\n2 3 1\n3 4 1\n4 1 -10", "-1"],
      ["3 2\n1 2 5\n2 3 5", "0 5 10\n1000000000 0 5\n1000000000 1000000000 0"],
      ["4 6\n1 2 2\n1 3 6\n1 4 8\n2 3 1\n3 4 2\n4 2 -5", "-1"],
      ["3 0", "0 1000000000 1000000000\n1000000000 0 1000000000\n1000000000 1000000000 0"],
      ["4 8\n1 2 3\n2 1 3\n2 3 1\n3 2 1\n3 4 2\n4 3 2\n1 4 10\n4 1 10", "0 3 4 6\n3 0 1 3\n4 1 0 2\n6 3 2 0"],
      ["2 2\n1 2 -1\n2 1 -1", "-1"],
      ["3 3\n1 2 4\n2 3 -3\n3 1 2", "-1"],
      ["4 3\n1 2 5\n2 3 3\n3 4 2", "0 5 8 10\n1000000000 0 3 5\n1000000000 1000000000 0 2\n1000000000 1000000000 1000000000 0"],
      ["3 3\n1 2 1\n2 3 2\n3 1 3", "0 1 3\n5 0 2\n3 4 0"],
    ]),
  },
  {
    title: "Topological Sort and Lexicographically Smallest Order",
    statement: `Given a DAG with $n$ nodes and $m$ directed edges, output the **lexicographically smallest** topological ordering.

### Input format
Line 1: two integers $n$ and $m$.
Next $m$ lines: two integers $u$ $v$ for a directed edge $u \\to v$.

### Output format
$n$ space-separated integers: the topological order. If multiple orderings exist, print the lexicographically smallest.

### Constraints
- $1 \\le n \\le 10^5$
- $0 \\le m \\le 2 \\times 10^5$

### Sample Input 1
\`\`\`
6 6
6 3
6 1
5 1
5 2
3 4
4 2
\`\`\`

### Sample Output 1
\`\`\`
5 6 1 3 4 2
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 262144,
    tests: cases([
      ["6 6\n6 3\n6 1\n5 1\n5 2\n3 4\n4 2", "5 6 1 3 4 2"],
      ["1 0", "1"],
      ["3 2\n1 2\n2 3", "1 2 3"],
      ["3 2\n2 3\n3 1", "2 3 1"],
      ["4 3\n1 2\n1 3\n2 4", "1 2 3 4"],
      ["4 4\n4 3\n4 2\n3 1\n2 1", "4 2 3 1"],
      ["5 0", "1 2 3 4 5"],
      ["5 4\n5 4\n5 3\n4 1\n3 2", "5 3 4 2 1"],
      ["4 2\n3 1\n4 2", "3 4 1 2"],
      ["6 5\n1 2\n1 3\n2 4\n3 5\n4 6", "1 2 3 4 5 6"],
      ["5 5\n1 2\n1 3\n2 4\n3 4\n4 5", "1 2 3 4 5"],
      ["4 3\n2 1\n3 1\n4 1", "2 3 4 1"],
      ["6 7\n1 3\n1 2\n3 5\n2 5\n5 4\n5 6\n4 6", "1 2 3 5 4 6"],
      ["5 4\n1 2\n3 4\n2 5\n4 5", "1 3 2 4 5"],
      ["7 6\n1 2\n1 3\n2 4\n3 5\n5 6\n4 7", "1 2 3 4 5 6 7"],
      ["4 4\n1 2\n1 3\n1 4\n2 3", "1 2 3 4"],
      ["6 6\n2 1\n3 1\n4 2\n4 3\n5 3\n6 5", "4 5 6 2 3 1"],
      ["5 4\n5 4\n5 3\n5 2\n5 1", "5 1 2 3 4"],
      ["6 5\n1 6\n2 6\n3 5\n4 5\n5 6", "1 2 3 4 5 6"],
      ["4 0", "1 2 3 4"],
    ]),
  },
  // ── MORE DP ────────────────────────────────────────────────────────────────
  {
    title: "DP on Grids: Minimum Cost Path with Obstacles",
    statement: `You are given an $n \\times m$ grid. Cell $(i,j)$ has a cost $c_{i,j}$. Some cells are blocked (marked $-1$). Find the minimum cost path from $(1,1)$ to $(n,m)$ moving only right or down. Output $-1$ if no path exists.

### Input format
Line 1: two integers $n$ and $m$.
Next $n$ lines: $m$ space-separated integers ($c_{i,j} \\ge 0$, or $-1$ if blocked).

### Output format
Minimum total cost (including start and end), or $-1$.

### Constraints
- $1 \\le n, m \\le 1000$
- $0 \\le c_{i,j} \\le 10^4$

### Sample Input 1
\`\`\`
3 3
1 3 1
1 5 1
4 2 1
\`\`\`

### Sample Output 1
\`\`\`
7
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 262144,
    tests: cases([
      ["3 3\n1 3 1\n1 5 1\n4 2 1", "7"],
      ["1 1\n5", "5"],
      ["2 2\n1 2\n3 4", "8"],
      ["2 2\n1 -1\n-1 4", "-1"],
      ["3 3\n-1 1 1\n1 1 1\n1 1 1", "-1"],
      ["3 3\n1 1 1\n1 1 1\n1 1 -1", "-1"],
      ["2 3\n1 2 3\n4 5 6", "14"],
      ["3 2\n1 4\n2 5\n3 6", "12"],
      ["3 3\n1 2 3\n4 5 6\n7 8 9", "21"],
      ["4 4\n1 1 1 1\n1 1 1 1\n1 1 1 1\n1 1 1 1", "7"],
      ["3 3\n0 0 0\n0 0 0\n0 0 0", "0"],
      ["3 3\n1 -1 1\n1 1 1\n1 -1 1", "5"],
      ["4 4\n1 2 3 4\n5 6 7 8\n9 10 11 12\n13 14 15 16", "44"],
      ["2 5\n1 2 3 4 5\n6 7 8 9 10", "25"],
      ["5 2\n1 6\n2 7\n3 8\n4 9\n5 10", "25"],
      ["3 3\n1 2 3\n-1 -1 4\n9 8 5", "15"],
      ["4 4\n1 1 1 1\n-1 -1 -1 1\n1 1 1 1\n1 -1 -1 1", "-1"],
      ["3 4\n1 1 1 1\n1 -1 -1 1\n1 1 1 1", "7"],
      ["5 5\n1 2 3 4 5\n2 3 4 5 6\n3 4 5 6 7\n4 5 6 7 8\n5 6 7 8 9", "33"],
      ["2 2\n0 0\n0 0", "0"],
    ]),
  },
  {
    title: "DP: Longest Palindromic Subsequence",
    statement: `Given a string $s$ of length $n$, find the length of its **longest palindromic subsequence** (not necessarily contiguous).

### Input format
A single string $s$ (lowercase English letters).

### Output format
A single integer: the length of the longest palindromic subsequence.

### Constraints
- $1 \\le |s| \\le 1000$

### Sample Input 1
\`\`\`
bbbab
\`\`\`

### Sample Output 1
\`\`\`
4
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 131072,
    tests: cases([
      ["bbbab", "4"],
      ["cbbd", "2"],
      ["a", "1"],
      ["aa", "2"],
      ["ab", "1"],
      ["abcba", "5"],
      ["abcde", "1"],
      ["aabaa", "5"],
      ["character", "5"],
      ["aaaa", "4"],
      ["abacaba", "7"],
      ["leetcode", "4"],
      ["racecar", "7"],
      ["abba", "4"],
      ["aabbbaa", "7"],
      ["abcbda", "5"],
      ["agbdba", "5"],
      ["zzazz", "5"],
      ["abcddcba", "8"],
      ["xyzyx", "5"],
    ]),
  },
  {
    title: "DP: Coin Change II (Count Ways)",
    statement: `Given coins of denominations $c_1, c_2, \\ldots, c_k$ and an amount $W$, count the number of distinct ways to make change for $W$ (order does not matter — combinations, not permutations). Output the answer modulo $10^9 + 7$.

### Input format
Line 1: two integers $W$ and $k$.
Line 2: $k$ space-separated integers $c_i$.

### Output format
The number of ways modulo $10^9 + 7$.

### Constraints
- $1 \\le W \\le 5000$
- $1 \\le k \\le 300$
- $1 \\le c_i \\le 5000$

### Sample Input 1
\`\`\`
5 3
1 2 5
\`\`\`

### Sample Output 1
\`\`\`
4
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 131072,
    tests: cases([
      ["5 3\n1 2 5", "4"],
      ["3 2\n2 3", "1"],
      ["10 4\n2 5 3 6", "5"],
      ["1 1\n1", "1"],
      ["1 1\n2", "0"],
      ["5 1\n5", "1"],
      ["5 1\n3", "0"],
      ["10 2\n1 2", "6"],
      ["100 3\n1 5 10", "121"],
      ["0 3\n1 2 5", "1"],
      ["5000 1\n1", "1"],
      ["10 10\n1 2 3 4 5 6 7 8 9 10", "128"],
      ["20 4\n1 5 10 20", "9"],
      ["15 3\n3 5 7", "3"],
      ["50 5\n1 5 10 25 50", "49"],
      ["6 3\n1 2 3", "7"],
      ["4 3\n1 2 4", "4"],
      ["12 4\n1 2 5 10", "15"],
      ["25 3\n5 10 25", "2"],
      ["1000 2\n3 5", "67"],
    ]),
  },
  {
    title: "DP: Edit Distance (Levenshtein)",
    statement: `Given two strings $s$ and $t$, compute the **edit distance** (minimum number of single-character insertions, deletions, or substitutions to transform $s$ into $t$).

### Input format
Two lines, each containing a string (lowercase English letters).

### Output format
A single integer: the edit distance.

### Constraints
- $1 \\le |s|, |t| \\le 1000$

### Sample Input 1
\`\`\`
horse
ros
\`\`\`

### Sample Output 1
\`\`\`
3
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 131072,
    tests: cases([
      ["horse\nros", "3"],
      ["intention\nexecution", "5"],
      ["a\na", "0"],
      ["a\nb", "1"],
      ["ab\nba", "2"],
      ["abc\nabc", "0"],
      ["abc\n", "3"],
      ["\nabc", "3"],
      ["kitten\nsitting", "3"],
      ["sunday\nsaturday", "3"],
      ["abcde\nace", "2"],
      ["algorithm\nalgorithm", "0"],
      ["abcd\ndcba", "4"],
      ["abcdef\nabc", "3"],
      ["abcdef\nfedcba", "6"],
      ["aaa\nbbb", "3"],
      ["aaaa\na", "3"],
      ["a\naaaa", "3"],
      ["abcdefghij\n", "10"],
      ["polynomial\nexponential", "6"],
    ]),
  },
  {
    title: "DP: Knapsack with Item Groups",
    statement: `You have $n$ items organized into $g$ groups. Each item $i$ has a weight $w_i$ and value $v_i$. From each group, you can pick **at most one** item. Given knapsack capacity $W$, maximize total value.

### Input format
Line 1: three integers $n$, $g$, $W$.
Next $n$ lines: three integers $\\text{group}_i$, $w_i$, $v_i$ ($1 \\le \\text{group}_i \\le g$).

### Output format
Maximum total value.

### Constraints
- $1 \\le n \\le 1000$
- $1 \\le g \\le 100$
- $1 \\le W \\le 1000$

### Sample Input 1
\`\`\`
4 2 5
1 2 3
1 3 5
2 1 2
2 3 4
\`\`\`

### Sample Output 1
\`\`\`
9
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 131072,
    tests: cases([
      ["4 2 5\n1 2 3\n1 3 5\n2 1 2\n2 3 4", "9"],
      ["1 1 10\n1 5 7", "7"],
      ["2 2 3\n1 2 5\n2 2 5", "10"],
      ["2 1 1\n1 2 5\n1 3 8", "0"],
      ["3 2 5\n1 3 4\n2 2 3\n2 4 6", "7"],
      ["4 2 4\n1 1 1\n1 2 3\n2 1 2\n2 3 5", "5"],
      ["6 3 10\n1 2 3\n1 4 5\n2 3 4\n2 5 7\n3 1 2\n3 6 8", "20"],
      ["3 3 5\n1 2 3\n2 3 4\n3 1 2", "9"],
      ["4 4 4\n1 1 3\n2 2 4\n3 1 2\n4 2 5", "14"],
      ["5 2 6\n1 3 5\n1 4 7\n2 1 2\n2 3 4\n2 5 9", "11"],
      ["6 3 8\n1 2 4\n1 3 6\n2 1 2\n2 4 8\n3 2 3\n3 5 10", "24"],
      ["4 2 10\n1 5 10\n1 3 7\n2 4 8\n2 6 12", "22"],
      ["5 3 7\n1 2 5\n2 3 6\n2 4 8\n3 1 3\n3 5 10", "21"],
      ["3 2 0\n1 2 3\n2 1 4\n2 3 7", "0"],
      ["6 2 5\n1 2 4\n1 3 6\n1 4 8\n2 1 2\n2 2 3\n2 3 5", "13"],
      ["4 3 6\n1 3 5\n2 2 4\n2 4 8\n3 1 2", "11"],
      ["5 2 5\n1 1 2\n1 2 3\n1 3 4\n2 2 3\n2 4 5", "9"],
      ["3 1 10\n1 3 5\n1 5 8\n1 7 12", "12"],
      ["4 2 5\n1 5 10\n1 3 6\n2 5 10\n2 3 6", "12"],
      ["6 3 9\n1 2 4\n1 4 7\n2 3 5\n2 4 8\n3 2 3\n3 5 9", "24"],
    ]),
  },
  {
    title: "Graph: Minimum Spanning Tree (Kruskal)",
    statement: `Given an undirected weighted graph with $n$ nodes and $m$ edges, find the weight of the **Minimum Spanning Tree** (MST). If the graph is disconnected, output $-1$.

### Input format
Line 1: two integers $n$ and $m$.
Next $m$ lines: three integers $u$, $v$, $w$.

### Output format
The total weight of the MST, or $-1$ if no spanning tree exists.

### Constraints
- $1 \\le n \\le 10^5$
- $0 \\le m \\le 2 \\times 10^5$
- $1 \\le w \\le 10^9$

### Sample Input 1
\`\`\`
4 5
1 2 1
1 3 3
2 3 2
2 4 4
3 4 5
\`\`\`

### Sample Output 1
\`\`\`
7
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 262144,
    tests: cases([
      ["4 5\n1 2 1\n1 3 3\n2 3 2\n2 4 4\n3 4 5", "7"],
      ["1 0", "0"],
      ["2 1\n1 2 5", "5"],
      ["2 0", "-1"],
      ["3 3\n1 2 1\n2 3 1\n3 1 1", "2"],
      ["4 4\n1 2 2\n2 3 2\n3 4 2\n4 1 2", "6"],
      ["5 7\n1 2 2\n1 3 3\n2 4 4\n2 5 5\n3 4 6\n3 5 7\n4 5 8", "14"],
      ["3 2\n1 2 10\n2 3 5", "15"],
      ["4 6\n1 2 1\n1 3 2\n1 4 3\n2 3 4\n2 4 5\n3 4 6", "6"],
      ["5 0", "-1"],
      ["5 4\n1 2 1\n2 3 1\n3 4 1\n4 5 1", "4"],
      ["6 9\n1 2 4\n1 6 2\n2 3 1\n2 6 5\n3 4 2\n3 5 4\n4 5 3\n5 6 7\n6 4 8", "12"],
      ["4 3\n1 2 100\n2 3 100\n3 4 100", "300"],
      ["5 10\n1 2 1\n1 3 2\n1 4 3\n1 5 4\n2 3 5\n2 4 6\n2 5 7\n3 4 8\n3 5 9\n4 5 10", "10"],
      ["3 1\n2 3 5", "-1"],
      ["6 6\n1 2 1\n2 3 1\n3 4 1\n4 5 1\n5 6 1\n6 1 1", "5"],
      ["5 8\n1 2 2\n1 3 5\n2 3 3\n2 4 4\n3 4 1\n3 5 6\n4 5 2\n1 5 10", "10"],
      ["4 4\n1 2 5\n1 3 5\n2 4 5\n3 4 5", "15"],
      ["5 6\n1 2 3\n2 3 3\n3 4 3\n4 5 3\n5 1 3\n1 3 3", "12"],
      ["3 3\n1 2 1000000000\n2 3 1000000000\n1 3 1000000000", "2000000000"],
    ]),
  },
  {
    title: "Graph: Dijkstra's SSSP",
    statement: `Given a directed weighted graph (all weights $\\ge 0$), find the shortest distance from node $1$ to every other node.

### Input format
Line 1: two integers $n$ and $m$.
Next $m$ lines: three integers $u$, $v$, $w$.

### Output format
$n$ space-separated integers: $\\text{dist}[1], \\text{dist}[2], \\ldots, \\text{dist}[n]$ where $\\text{dist}[i]$ is $-1$ if unreachable.

### Constraints
- $1 \\le n \\le 10^5$
- $0 \\le m \\le 2 \\times 10^5$
- $0 \\le w \\le 10^9$

### Sample Input 1
\`\`\`
5 7
1 2 4
1 3 2
2 3 5
2 4 10
3 4 3
3 5 7
4 5 1
\`\`\`

### Sample Output 1
\`\`\`
0 4 2 5 6
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 262144,
    tests: cases([
      ["5 7\n1 2 4\n1 3 2\n2 3 5\n2 4 10\n3 4 3\n3 5 7\n4 5 1", "0 4 2 5 6"],
      ["1 0", "0"],
      ["2 1\n1 2 5", "0 5"],
      ["2 0", "0 -1"],
      ["3 3\n1 2 1\n2 3 1\n1 3 5", "0 1 2"],
      ["4 4\n1 2 1\n1 3 4\n2 3 2\n3 4 1", "0 1 3 4"],
      ["5 5\n1 2 2\n2 3 2\n3 4 2\n4 5 2\n1 5 20", "0 2 4 6 8"],
      ["4 3\n2 3 1\n3 4 1\n2 4 1", "0 -1 -1 -1"],
      ["5 6\n1 2 3\n1 3 1\n2 4 2\n3 4 4\n3 5 5\n4 5 1", "0 3 1 5 6"],
      ["3 3\n1 2 0\n2 3 0\n1 3 1", "0 0 0"],
      ["6 8\n1 2 7\n1 3 9\n1 6 14\n2 3 10\n2 4 15\n3 4 11\n3 6 2\n4 5 6", "0 7 9 20 26 11"],
      ["4 4\n1 2 1\n2 3 1\n3 4 1\n4 1 1", "0 1 2 3"],
      ["5 4\n1 2 10\n1 3 5\n3 4 5\n4 5 5", "0 10 5 10 15"],
      ["4 0", "0 -1 -1 -1"],
      ["5 8\n1 2 1\n1 3 4\n2 3 2\n2 4 5\n3 4 1\n3 5 7\n4 5 2\n2 5 9", "0 1 3 4 6"],
      ["6 7\n1 2 2\n1 3 5\n2 4 4\n3 4 1\n4 5 3\n3 6 6\n5 6 2", "0 2 5 6 9 11"],
      ["3 2\n1 2 1000000000\n2 3 1000000000", "0 1000000000 2000000000"],
      ["5 6\n1 2 0\n1 3 0\n2 4 0\n3 4 0\n4 5 0\n3 5 1", "0 0 0 0 0"],
      ["4 5\n1 2 3\n1 3 5\n1 4 9\n2 3 1\n3 4 3", "0 3 4 7"],
      ["5 7\n1 2 1\n1 4 5\n2 3 1\n3 4 1\n4 5 1\n2 5 6\n3 5 4", "0 1 2 3 4"],
    ]),
  },
  {
    title: "DP: Number of Increasing Subsequences Mod P",
    statement: `Given an array $a_1, \\ldots, a_n$ and a prime $p$, count the number of **strictly increasing subsequences** (including the empty subsequence) modulo $p$.

### Input format
Line 1: two integers $n$ and $p$.
Line 2: $n$ space-separated integers.

### Output format
The count modulo $p$.

### Constraints
- $1 \\le n \\le 3000$
- $p$ is prime, $10^8 < p < 2 \\times 10^9$
- $1 \\le a_i \\le 10^9$

### Sample Input 1
\`\`\`
5 1000000007
3 1 4 1 5
\`\`\`

### Sample Output 1
\`\`\`
11
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 131072,
    tests: cases([
      ["5 1000000007\n3 1 4 1 5", "11"],
      ["1 1000000007\n5", "2"],
      ["3 1000000007\n1 2 3", "8"],
      ["3 1000000007\n3 2 1", "4"],
      ["4 1000000007\n1 1 1 1", "5"],
      ["5 1000000007\n1 2 3 4 5", "32"],
      ["4 1000000007\n2 1 4 3", "10"],
      ["6 1000000007\n1 2 1 2 1 2", "13"],
      ["3 1000000007\n2 2 2", "4"],
      ["5 1000000007\n5 4 3 2 1", "6"],
      ["4 1000000007\n1 3 2 4", "12"],
      ["6 1000000007\n1 2 3 1 2 3", "22"],
      ["5 1000000007\n1 5 2 4 3", "16"],
      ["4 1000000007\n3 1 4 2", "9"],
      ["6 1000000007\n2 3 1 2 3 4", "27"],
      ["5 1000000007\n1 2 2 3 3", "14"],
      ["4 1000000007\n4 3 2 1", "5"],
      ["6 1000000007\n1 3 2 4 3 5", "29"],
      ["5 1000000007\n2 4 1 3 5", "21"],
      ["6 1000000007\n1 2 3 4 5 6", "64"],
    ]),
  },
  {
    title: "Graph: Strongly Connected Components — Kosaraju's Algorithm",
    statement: `Implement Kosaraju's two-pass algorithm to find SCCs. Output the number of SCCs and, for each SCC, the sorted list of nodes in it (SCCs sorted by their smallest node).

### Input format
Line 1: two integers $n$ and $m$.
Next $m$ lines: two integers $u$ $v$ for a directed edge.

### Output format
Line 1: integer $k$ (number of SCCs).
Next $k$ lines: space-separated node indices for each SCC, sorted ascending, SCCs sorted by their minimum element ascending.

### Constraints
- $1 \\le n \\le 10^4$
- $0 \\le m \\le 5 \\times 10^4$

### Sample Input 1
\`\`\`
7 8
1 2
2 3
3 1
4 2
4 3
4 5
5 6
6 5
\`\`\`

### Sample Output 1
\`\`\`
4
1 2 3
4
5 6
7
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 131072,
    tests: cases([
      ["7 8\n1 2\n2 3\n3 1\n4 2\n4 3\n4 5\n5 6\n6 5", "4\n1 2 3\n4\n5 6\n7"],
      ["3 3\n1 2\n2 3\n3 1", "1\n1 2 3"],
      ["3 0", "3\n1\n2\n3"],
      ["4 3\n1 2\n2 3\n3 4", "4\n1\n2\n3\n4"],
      ["5 6\n1 2\n2 3\n3 1\n3 4\n4 5\n5 3", "2\n1 2 3 4 5"],
      ["4 4\n1 2\n2 1\n3 4\n4 3", "2\n1 2\n3 4"],
      ["6 6\n1 2\n2 3\n3 1\n4 5\n5 6\n6 4", "2\n1 2 3\n4 5 6"],
      ["5 5\n1 2\n2 3\n3 4\n4 5\n5 1", "1\n1 2 3 4 5"],
      ["4 4\n1 2\n2 3\n3 1\n4 1", "2\n1 2 3\n4"],
      ["6 7\n1 2\n2 3\n3 1\n4 5\n5 6\n6 4\n1 4", "2\n1 2 3\n4 5 6"],
      ["5 4\n1 2\n3 4\n4 3\n5 1", "3\n1 2\n3 4\n5"],
      ["4 2\n1 2\n3 4", "4\n1\n2\n3\n4"],
      ["6 8\n1 2\n2 1\n3 4\n4 5\n5 6\n6 3\n1 3\n4 2", "2\n1 2\n3 4 5 6"],
      ["5 6\n1 2\n2 3\n3 2\n3 4\n4 5\n5 4", "3\n1\n2 3\n4 5"],
      ["4 4\n1 2\n2 3\n3 4\n4 2", "2\n1\n2 3 4"],
      ["7 7\n1 2\n2 3\n3 1\n4 5\n5 6\n6 4\n7 1", "3\n1 2 3\n4 5 6\n7"],
      ["6 6\n1 2\n2 3\n3 1\n1 4\n4 5\n5 1", "1\n1 2 3 4 5\n6"],
      ["5 5\n1 2\n2 1\n3 4\n4 5\n5 3", "2\n1 2\n3 4 5"],
      ["6 9\n1 2\n2 3\n3 1\n4 5\n5 6\n6 4\n1 4\n2 5\n3 6", "2\n1 2 3\n4 5 6"],
      ["4 4\n1 3\n2 3\n3 4\n4 3", "3\n1\n2\n3 4"],
    ]),
  },
  {
    title: "DP: Matrix Chain Multiplication",
    statement: `Given $n$ matrices $M_1, M_2, \\ldots, M_n$ where matrix $M_i$ has dimensions $p_{i-1} \\times p_i$, find the minimum number of scalar multiplications to compute the product $M_1 M_2 \\cdots M_n$.

### Input format
Line 1: integer $n$.
Line 2: $n+1$ integers $p_0, p_1, \\ldots, p_n$.

### Output format
A single integer: the minimum number of scalar multiplications.

### Constraints
- $2 \\le n \\le 500$
- $1 \\le p_i \\le 10^3$

### Sample Input 1
\`\`\`
4
40 20 30 10 30
\`\`\`

### Sample Output 1
\`\`\`
26000
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 131072,
    tests: cases([
      ["4\n40 20 30 10 30", "26000"],
      ["2\n10 100 5", "5000"],
      ["3\n10 30 5 60", "27000"],
      ["2\n1 1 1", "1"],
      ["4\n1 2 3 4 5", "38"],
      ["5\n10 20 30 40 50 60", "360000"],
      ["3\n5 4 3 2", "70"],
      ["4\n2 3 4 5 6", "124"],
      ["6\n1 2 3 4 5 6 7", "228"],
      ["2\n100 1 100", "10000"],
      ["3\n10 10 10 10", "2000"],
      ["4\n5 10 3 12 5", "630"],
      ["5\n30 35 15 5 10 20", "15125"],
      ["3\n1 100 1 100", "200"],
      ["4\n10 20 10 20 10", "6000"],
      ["6\n2 3 4 5 6 7 8", "450"],
      ["2\n1000 1 1000", "1000000"],
      ["3\n100 1 100 1", "200"],
      ["5\n5 5 5 5 5 5", "500"],
      ["4\n1 1 1 1 1", "3"],
    ]),
  },
  {
    title: "Graph: Shortest Path with K Edges (Bellman-Ford variant)",
    statement: `Given a directed weighted graph on $n$ nodes and $m$ edges, find the shortest path from node $1$ to node $n$ using **exactly** $k$ edges. Output the minimum cost, or $-1$ if no such path exists.

### Input format
Line 1: three integers $n$, $m$, $k$.
Next $m$ lines: three integers $u$, $v$, $w$.

### Output format
The minimum cost using exactly $k$ edges, or $-1$.

### Constraints
- $1 \\le n \\le 100$
- $0 \\le m \\le n^2$
- $1 \\le k \\le 100$
- $|w| \\le 10^4$

### Sample Input 1
\`\`\`
4 5 2
1 2 10
3 2 -5
2 4 7
3 4 2
1 3 4
\`\`\`

### Sample Output 1
\`\`\`
6
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 131072,
    tests: cases([
      ["4 5 2\n1 2 10\n3 2 -5\n2 4 7\n3 4 2\n1 3 4", "6"],
      ["2 1 1\n1 2 5", "5"],
      ["2 1 2\n1 2 5", "-1"],
      ["3 2 2\n1 2 3\n2 3 4", "7"],
      ["3 2 1\n1 2 3\n2 3 4", "3"],
      ["4 4 3\n1 2 1\n2 3 1\n3 4 1\n2 4 5", "3"],
      ["4 4 2\n1 2 1\n2 3 1\n3 4 1\n2 4 5", "-1"],
      ["3 3 2\n1 2 1\n1 3 10\n2 3 1", "2"],
      ["5 5 4\n1 2 1\n2 3 1\n3 4 1\n4 5 1\n1 5 10", "4"],
      ["4 6 3\n1 2 2\n1 3 5\n2 4 3\n3 4 1\n2 3 1\n3 2 1", "4"],
      ["3 3 3\n1 2 1\n2 3 1\n3 2 -5", "-1"],
      ["4 3 3\n1 2 1\n2 3 1\n3 4 1", "3"],
      ["5 6 4\n1 2 1\n2 3 1\n3 4 1\n4 5 1\n2 4 1\n1 4 1", "4"],
      ["3 2 1\n1 2 5\n2 3 5", "5"],
      ["4 5 3\n1 2 3\n2 3 2\n3 4 1\n1 3 10\n2 4 5", "6"],
      ["3 3 2\n1 2 -1\n2 3 -1\n1 3 -1", "-1"],
      ["4 4 2\n1 2 1\n2 4 1\n1 3 2\n3 4 2", "2"],
      ["5 5 4\n1 2 1\n2 3 1\n3 5 1\n1 4 1\n4 5 2", "4"],
      ["3 3 2\n1 2 4\n2 3 3\n1 3 10", "7"],
      ["4 3 2\n1 2 5\n2 3 3\n3 4 2", "8"],
    ]),
  },
  {
    title: "DP: Maximum Sum Rectangle in 2D Array",
    statement: `Given an $n \\times m$ integer matrix, find the maximum sum sub-rectangle (contiguous block).

### Input format
Line 1: two integers $n$ and $m$.
Next $n$ lines: $m$ space-separated integers.

### Output format
A single integer: the maximum sub-rectangle sum.

### Constraints
- $1 \\le n, m \\le 200$
- $-10^4 \\le a_{i,j} \\le 10^4$

### Sample Input 1
\`\`\`
4 5
1 2 -1 -4 -20
-8 -3 4 2 1
3 8 10 1 3
-4 -1 1 7 -6
\`\`\`

### Sample Output 1
\`\`\`
29
\`\`\``,
    timeLimitMs: 2000,
    memoryLimitKb: 131072,
    tests: cases([
      ["4 5\n1 2 -1 -4 -20\n-8 -3 4 2 1\n3 8 10 1 3\n-4 -1 1 7 -6", "29"],
      ["1 1\n5", "5"],
      ["1 1\n-5", "-5"],
      ["2 2\n1 2\n3 4", "10"],
      ["2 2\n-1 -2\n-3 -4", "-1"],
      ["3 3\n1 2 3\n4 5 6\n7 8 9", "45"],
      ["3 3\n-1 -2 -3\n-4 5 6\n-7 -8 -9", "11"],
      ["2 3\n1 -2 3\n-4 5 -6", "5"],
      ["3 3\n0 0 0\n0 10 0\n0 0 0", "10"],
      ["4 4\n-5 -5 -5 -5\n-5 100 100 -5\n-5 100 100 -5\n-5 -5 -5 -5", "400"],
      ["3 3\n1 -1 1\n-1 1 -1\n1 -1 1", "1"],
      ["2 4\n-2 1 -3 4\n-1 3 -2 1", "5"],
      ["3 4\n2 1 -3 -4\n0 6 3 2\n-1 2 -1 3", "14"],
      ["4 3\n-1 2 3\n4 -1 2\n-2 4 -3\n3 -2 1", "12"],
      ["3 3\n10000 10000 10000\n10000 10000 10000\n10000 10000 10000", "90000"],
      ["2 2\n-10000 -10000\n-10000 -10000", "-10000"],
      ["4 4\n1 2 3 4\n5 6 7 8\n-1 -2 -3 -4\n9 10 11 12", "60"],
      ["3 5\n0 -2 -7 0 0\n9 2 -6 2 0\n-4 1 -4 1 0", "13"],
      ["4 4\n-3 -2 -1 -4\n0 6 3 2\n-1 2 -1 3\n1 2 3 4", "24"],
      ["1 5\n-2 -3 4 -1 2", "5"],
    ]),
  },
];

async function main() {
  for (const q of QUESTIONS) {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO questions (title, statement, time_limit_ms, memory_limit_kb)
      VALUES (${q.title}, ${q.statement}, ${q.timeLimitMs}, ${q.memoryLimitKb})
      RETURNING id
    `;
    const id = row.id;
    for (let i = 0; i < q.tests.length; i++) {
      const t = q.tests[i];
      await sql`
        INSERT INTO test_cases (question_id, ord, input, expected_output, is_sample, weight)
        VALUES (${id}, ${i + 1}, ${t.input}, ${t.output}, ${i < 2}, 1)
      `;
    }
    console.log(`Seeded: ${q.title} (${q.tests.length} tests)`);
  }
  console.log(`\nDone. Seeded ${QUESTIONS.length} hard questions.`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
