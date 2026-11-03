// Applies db/*.sql in order, once each. Plain Node so the production image can run it without a build step.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

async function migrate() {
  const sql = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  try {
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const applied = new Set((await sql`SELECT name FROM schema_migrations`).map((row) => row.name));
    for (const file of readdirSync("db").filter((name) => /^\d+_.*\.sql$/.test(name)).sort()) {
      if (applied.has(file)) continue;
      await sql.begin(async (tx) => {
        await tx.unsafe(readFileSync(join("db", file), "utf8"));
        await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      });
      console.log(`applied ${file}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// New connections to the database are occasionally refused on this cluster; retry instead of failing the pod.
for (let attempt = 1; ; attempt++) {
  try {
    await migrate();
    break;
  } catch (error) {
    if (attempt >= 15) throw error;
    console.log(`migration attempt ${attempt} failed (${error.code ?? error.message}); retrying`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
