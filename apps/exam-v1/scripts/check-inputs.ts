import postgres from "postgres";
async function main() {
  const db = postgres(process.env.DATABASE_URL!, { max: 1 });
  const findPath = await db`SELECT q.title, tc.case_number, tc.input, tc.expected_output FROM test_cases tc JOIN questions q ON q.id = tc.question_id WHERE q.title = 'Find the Path' ORDER BY tc.case_number LIMIT 5`;
  console.log("=== Find the Path ===");
  for (const r of findPath) console.log(`Case ${r.case_number}: input=${JSON.stringify(r.input)} expected=${JSON.stringify(r.expected_output)}`);
  const maze = await db`SELECT q.title, tc.case_number, tc.input, tc.expected_output FROM test_cases tc JOIN questions q ON q.id = tc.question_id WHERE q.title = 'Escape the Maze' ORDER BY tc.case_number LIMIT 5`;
  console.log("=== Escape the Maze ===");
  for (const r of maze) console.log(`Case ${r.case_number}: input=${JSON.stringify(r.input)} expected=${JSON.stringify(r.expected_output)}`);
  await db.end();
}
main().catch(console.error);
