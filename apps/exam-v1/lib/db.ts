import postgres from "postgres";

const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

function client(): postgres.Sql {
  if (globalForDb.sql) return globalForDb.sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  globalForDb.sql = postgres(url, {
    max: Number(process.env.DATABASE_POOL_SIZE ?? 20),
    idle_timeout: 30,
    prepare: true,
  });
  return globalForDb.sql;
}

// Connects on first use, so `next build` can import routes without a database.
export const sql = new Proxy(function () {} as unknown as postgres.Sql, {
  apply: (_target, _this, args: Parameters<postgres.Sql>) => client()(...args),
  get: (_target, property) => Reflect.get(client(), property),
});

export function listen(channel: string, callback: (payload: string) => void): Promise<{ unlisten: () => Promise<void> }> {
  return client().listen(channel, callback);
}
