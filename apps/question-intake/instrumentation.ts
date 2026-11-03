/** Opens the database pool at startup, retrying: new connections are occasionally refused on this cluster. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { sql } = await import("./lib/db");
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          await sql`select 1`;
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
    }),
  );
}
