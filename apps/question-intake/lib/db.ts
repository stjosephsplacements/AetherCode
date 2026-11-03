import "server-only";
import postgres from "postgres";
import { required } from "./env.ts";

const globalForDb = globalThis as unknown as { intakeSql?: postgres.Sql };

/** One pool per server process, opened on first use so a build never needs the database. */
function pool(): postgres.Sql {
  return (globalForDb.intakeSql ??= postgres(required("DATABASE_URL"), { max: 5, onnotice: () => {} }));
}

export const sql: postgres.Sql = new Proxy((() => undefined) as unknown as postgres.Sql, {
  apply: (_target, _this, args) => (pool() as unknown as (...parameters: unknown[]) => unknown)(...args),
  get: (_target, property) => Reflect.get(pool(), property),
});
