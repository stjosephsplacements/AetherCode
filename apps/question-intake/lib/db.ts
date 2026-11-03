import "server-only";
import postgres from "postgres";
import { required } from "./env.ts";

const globalForDb = globalThis as unknown as { intakeSql?: postgres.Sql };

/** One pool per server process (reused across hot reloads in development). */
export const sql: postgres.Sql = (globalForDb.intakeSql ??= postgres(required("DATABASE_URL"), { max: 5, onnotice: () => {} }));
