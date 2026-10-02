import postgres from "postgres";

const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

function connect(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  return postgres(url, { max: Number(process.env.DATABASE_POOL_SIZE ?? 20), idle_timeout: 30 });
}

export const sql: postgres.Sql = globalForDb.sql ?? connect();
if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;
