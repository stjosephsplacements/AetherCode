import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const sql = postgres(url, { max: 1, onnotice: () => {} });

await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
const applied = new Set((await sql`SELECT name FROM schema_migrations`).map((row) => row.name as string));
for (const file of readdirSync("db").filter((name) => name.endsWith(".sql")).sort()) {
  if (applied.has(file)) continue;
  await sql.begin(async (tx) => {
    await tx.unsafe(readFileSync(join("db", file), "utf8"));
    await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
  });
  console.log(`applied ${file}`);
}
await sql.end();
