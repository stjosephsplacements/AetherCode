import "server-only";
import { sql } from "./db.ts";

export type Topic = { id: string; name: string; parent_id: string | null; easy: number; medium: number; hard: number; total: number };

/** Every topic with how many questions it holds at each difficulty (its own, not its sub-topics'). */
export async function listTopics(): Promise<Topic[]> {
  const rows = await sql`
    SELECT c.id, c.name, c.parent_id,
           count(q.id) FILTER (WHERE q.difficulty = 'easy')::int AS easy,
           count(q.id) FILTER (WHERE q.difficulty = 'medium')::int AS medium,
           count(q.id) FILTER (WHERE q.difficulty = 'hard')::int AS hard,
           count(q.id)::int AS total
    FROM categories c LEFT JOIN questions q ON q.category_id = c.id
    GROUP BY c.id ORDER BY c.parent_id NULLS FIRST, lower(c.name)`;
  return rows as unknown as Topic[];
}

export async function getTopic(id: string): Promise<Topic | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await listTopics()).find((topic) => topic.id === id) ?? null;
}

/** Topics as an indented list for a picker: a sub-topic follows its parent. */
export function topicOptions(topics: Topic[]): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const topic of topics.filter((entry) => entry.parent_id === parent)) {
      out.push({ value: topic.id, label: `${"  ".repeat(depth)}${depth > 0 ? "↳ " : ""}${topic.name}` });
      visit(topic.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}
