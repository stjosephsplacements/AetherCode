import { NextResponse } from "next/server";
import { authorizeStaff } from "@/lib/authorize.ts";
import { sql } from "@/lib/db";

/** Topics (categories) with a count of saved questions, for the bank import picker. */
export async function GET(request: Request) {
  const auth = await authorizeStaff(request);
  if (auth instanceof NextResponse) return auth;
  const topics = await sql`
    SELECT c.id, c.name, p.name AS parent_name,
           (SELECT count(*)::int FROM questions q WHERE q.category_id = c.id) AS question_count
    FROM categories c
    LEFT JOIN categories p ON p.id = c.parent_id
    ORDER BY coalesce(p.normalized_name, c.normalized_name), c.normalized_name`;
  return NextResponse.json({ topics });
}