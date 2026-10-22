/**
 * Fix test case counts for HOPE Day 4 questions — pad to exactly 20 each.
 * Also remove the extra TC from "Count Pattern Occurrences" (21 → 20).
 */
import { sql } from "../lib/db.ts";

const EXTRA: Record<string, [string, string][]> = {
  // Jump Game: needs 2 more hidden
  "1d3d695e-1450-4b72-a743-2e4321421f54": [
    ["6\n2 0 1 1 2 0", "YES"],
    ["8\n4 0 0 0 3 0 0 1", "YES"],
  ],
  // Minimum Platforms: needs 2 more hidden
  "05a7e8f3-eea2-4b59-90bd-f0df86bf091f": [
    ["1\n900\n910", "1"],
    ["4\n100 200 300 400\n110 210 310 410", "1"],
  ],
  // Partition Labels: needs 1 more hidden
  "3cb4be47-ecfb-48a1-92f2-ebe88e6b61bc": [
    ["abcdefghijklmnopqrstuvwxyz", "26"],
  ],
  // Gas Station Circuit: needs 1 more hidden
  "08f02d7b-e68d-4620-b54a-c67a1030d841": [
    ["4\n5 5 5 5\n4 4 4 4", "0"],
  ],
  // Largest Number: needs 1 more hidden
  "401fa01b-3dea-4820-9037-25dd414499a7": [
    ["4\n9 99 999 9999", "9999999999"],
  ],
  // Number of Islands: needs 1 more hidden
  "a628b395-1aac-4a61-99dd-e35f17f32d67": [
    ["1 1\n0", "0"],
  ],
  // Course Schedule: needs 1 more hidden
  "703234a7-7b06-4c71-8a1c-0dbe9c48f7ff": [
    ["1 0", "YES"],
  ],
  // Bipartite Check: needs 1 more hidden
  "ed814d13-a567-4170-9f47-a77de2293d64": [
    ["1 0", "YES"],
  ],
  // Shortest Path in Unweighted Graph: needs 1 more hidden
  "9a8e823b-e0e7-40bd-969c-e1882422837e": [
    ["2 0 1 2", "-1"],
  ],
  // Number of Provinces: needs 2 more hidden
  "c35f2070-01e7-4f5c-a3ee-14738e81ee5b": [
    ["1\n1", "1"],
    ["2\n1 1\n1 1", "1"],
  ],
  // Prefix Count: needs 1 more hidden
  "f222f2d0-d280-40f3-882c-169f4cedb888": [
    ["3 1\napple application ape\nap", "3"],
  ],
  // Single Number III: needs 1 more hidden
  "953d3510-d3ec-47d6-bee0-c6c8c1787406": [
    ["6\n1 2 1 3 2 5", "3 5"],
  ],
  // Shortest Path with Negative Edges: needs 1 more hidden
  "6d5142ba-b5a5-4d60-a939-4439049fd737": [
    ["2 1\n1 2 5", "5"],
  ],
  // Reverse Linked List in K-Groups: needs 1 more hidden
  "a9761c7e-5467-42c9-af3d-2c6c0a1ef1d1": [
    ["6 6\n1 2 3 4 5 6", "6 5 4 3 2 1"],
  ],
  // Merge K Sorted Lists: needs 1 more hidden
  "8691b82c-98bd-47f4-98b8-eb014a4b4ebe": [
    ["1\n1 42", "42"],
  ],
  // Binary Tree Level Order Traversal: needs 1 more hidden
  "f858349a-f86a-4684-8caf-94c2231a502b": [
    ["1\n5", "5"],
  ],
  // Lowest Common Ancestor in BST: needs 1 more hidden
  "8b356a12-a66b-4a9e-bb3d-185c37877bf2": [
    ["3\n2 1 3\n1 3", "2"],
  ],
  // Kth Smallest Element in BST: needs 1 more hidden
  "a9a00374-734b-4356-9b26-1e8aa100cfc5": [
    ["1\n5\n1", "5"],
  ],
};

// Count Pattern Occurrences has 21 — remove the last hidden one
const TRIM = "6ab52822-be57-472c-a198-a7c12c815b15";

async function main() {
  // Add missing test cases
  for (const [questionId, newCases] of Object.entries(EXTRA)) {
    const [{ max_ord }] = await sql<[{ max_ord: number }]>`
      SELECT max(ord)::int as max_ord FROM test_cases WHERE question_id = ${questionId}`;
    for (let i = 0; i < newCases.length; i++) {
      const [input, output] = newCases[i];
      await sql`
        INSERT INTO test_cases (question_id, ord, input, expected_output, is_sample)
        VALUES (${questionId}, ${max_ord + i + 1}, ${input}, ${output}, false)`;
    }
    const [{ count }] = await sql<[{ count: number }]>`
      SELECT count(*)::int FROM test_cases WHERE question_id = ${questionId}`;
    console.log(`  ${questionId}: padded to ${count} TCs`);
  }

  // Trim the one with 21 TCs
  const [last] = await sql<[{ id: string }]>`
    SELECT id FROM test_cases WHERE question_id = ${TRIM} AND NOT is_sample
    ORDER BY ord DESC LIMIT 1`;
  if (last) {
    await sql`DELETE FROM test_cases WHERE id = ${last.id}`;
    const [{ count }] = await sql<[{ count: number }]>`
      SELECT count(*)::int FROM test_cases WHERE question_id = ${TRIM}`;
    console.log(`  ${TRIM}: trimmed to ${count} TCs`);
  }

  // Final verification
  const bad = await sql<{ title: string; count: number }[]>`
    SELECT q.title, (SELECT count(*)::int FROM test_cases t WHERE t.question_id = q.id) as count
    FROM exams e JOIN exam_questions eq ON eq.exam_id = e.id JOIN questions q ON q.id = eq.question_id
    WHERE e.title LIKE 'HOPE Day 4%' AND (SELECT count(*) FROM test_cases t WHERE t.question_id = q.id) != 20`;
  if (bad.length === 0) {
    console.log("\n✓ All 25 questions now have exactly 20 test cases");
  } else {
    console.log(`\n✗ ${bad.length} questions still wrong:`);
    for (const row of bad) console.log(`  ${row.title}: ${row.count}`);
  }

  await sql.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
