import { sql } from "../lib/db.js";

const q = {
  title: "DP: Subset Sum Count Modulo P",
  statement: `Given an array $a_1, \\ldots, a_n$ and integers $S$ and $p$, count the number of **subsets** (including the empty subset) whose sum equals exactly $S$. Output the count modulo $p$.

### Input format
Line 1: three integers $n$, $S$, $p$.
Line 2: $n$ space-separated non-negative integers.

### Output format
A single integer: the count modulo $p$.

### Constraints
- $1 \\le n \\le 1000$
- $0 \\le a_i \\le 1000$
- $1 \\le S \\le 10^6$
- $2 \\le p \\le 10^9$

### Sample Input 1
\`\`\`
5 5 1000000007
1 2 3 4 5
\`\`\`

### Sample Output 1
\`\`\`
3
\`\`\`

### Explanation
Subsets summing to 5: $\\{5\\}$, $\\{1,4\\}$, $\\{2,3\\}$.`,
  timeLimitMs: 2000,
  memoryLimitKb: 262144,
  tests: [
    ["5 5 1000000007\n1 2 3 4 5", "3"],
    ["1 0 1000000007\n5", "1"],
    ["1 5 1000000007\n5", "1"],
    ["1 5 1000000007\n3", "0"],
    ["4 6 1000000007\n1 2 3 4", "3"],
    ["5 0 1000000007\n1 2 3 4 5", "1"],
    ["3 6 1000000007\n1 2 3", "1"],
    ["5 10 1000000007\n1 2 3 4 5", "3"],
    ["4 4 1000000007\n1 1 1 1", "1"],
    ["6 7 1000000007\n1 2 3 4 5 6", "5"],
    ["3 3 1000000007\n1 1 1", "1"],
    ["5 15 1000000007\n1 2 3 4 5", "1"],
    ["4 5 1000000007\n2 3 5 7", "2"],
    ["5 8 1000000007\n1 2 3 4 5", "3"],
    ["6 9 1000000007\n1 2 3 4 5 6", "5"],
    ["4 10 1000000007\n2 3 4 5", "2"],
    ["5 7 1000000007\n1 2 3 4 5", "4"],
    ["6 10 1000000007\n1 2 3 4 5 6", "5"],
    ["3 5 3\n2 3 5", "2"],
    ["5 6 7\n1 2 3 4 5", "4"],
  ],
};

async function main() {
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO questions (title, statement, time_limit_ms, memory_limit_kb)
    VALUES (${q.title}, ${q.statement}, ${q.timeLimitMs}, ${q.memoryLimitKb})
    RETURNING id
  `;
  for (let i = 0; i < q.tests.length; i++) {
    const [inp, out] = q.tests[i];
    await sql`
      INSERT INTO test_cases (question_id, ord, input, expected_output, is_sample, weight)
      VALUES (${row.id}, ${i + 1}, ${inp}, ${out}, ${i < 2}, 1)
    `;
  }
  console.log(`Seeded: ${q.title} (${q.tests.length} tests)`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
