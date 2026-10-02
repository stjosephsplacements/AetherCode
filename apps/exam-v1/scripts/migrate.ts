import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "../lib/db.ts";

const dir = path.join(import.meta.dirname, "..", "db");

await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
const applied = new Set((await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((row) => row.name));
const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
for (const name of files) {
  if (applied.has(name)) continue;
  const body = await readFile(path.join(dir, name), "utf8");
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
    await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
  });
  console.log(`applied ${name}`);
}
console.log("migrations up to date");
await sql.end();
