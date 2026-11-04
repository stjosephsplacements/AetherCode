"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { normalizeCategory, validCategoryName } from "@/lib/platform";
import { requireViewer } from "@/lib/session";

export type TopicResult = { error: string } | { id: string; created: boolean };

/** Adds a topic (the platform's category). The same name in any letter case under the same parent returns the existing one. */
export async function createTopic(nameInput: string, parentId: string | null): Promise<TopicResult> {
  const { viewer } = await requireViewer();
  const name = nameInput.trim();
  if (!validCategoryName(name)) return { error: "A topic name is 1 to 80 characters, with no line breaks." };
  if (parentId !== null) {
    const [parent] = await sql`SELECT parent_id FROM categories WHERE id = ${parentId}`;
    if (!parent) return { error: "That parent topic no longer exists." };
    if (parent.parent_id) return { error: "Topics nest one level: a sub-topic cannot have its own sub-topics." };
  }
  const [existing] = await sql`SELECT id FROM categories WHERE normalized_name = ${normalizeCategory(name)} AND parent_id IS NOT DISTINCT FROM ${parentId}`;
  if (existing) return { id: existing.id as string, created: false };
  const [created] = await sql`INSERT INTO categories (name, normalized_name, parent_id, created_by, created_by_name) VALUES (${name}, ${normalizeCategory(name)}, ${parentId}, ${viewer.principalId}, ${viewer.name}) RETURNING id`;
  revalidatePath("/");
  return { id: created!.id as string, created: true };
}

export async function renameTopic(id: string, nameInput: string): Promise<{ error: string } | { ok: true }> {
  await requireViewer();
  const name = nameInput.trim();
  if (!validCategoryName(name)) return { error: "A topic name is 1 to 80 characters, with no line breaks." };
  try {
    await sql`UPDATE categories SET name = ${name}, normalized_name = ${normalizeCategory(name)} WHERE id = ${id}`;
  } catch (error) {
    if (error instanceof Error && /categories_sibling_name/.test(error.message)) return { error: "A topic with that name already exists here." };
    throw error;
  }
  revalidatePath("/");
  revalidatePath(`/topics/${id}`);
  return { ok: true };
}

/** Deletes an empty topic. A topic with questions or sub-topics stays: move or delete those first. */
export async function deleteTopic(id: string) {
  const { viewer } = await requireViewer();
  const admin = viewer.roles.some((role) => role === "super_admin" || role === "college_admin");
  const [topic] = await sql`SELECT created_by FROM categories WHERE id = ${id}`;
  if (!topic || (topic.created_by !== viewer.principalId && !admin)) return;
  const [inUse] = await sql`SELECT (SELECT count(*) FROM questions WHERE category_id = ${id}) + (SELECT count(*) FROM categories WHERE parent_id = ${id}) AS n`;
  if (Number(inUse!.n) > 0) return;
  await sql`DELETE FROM categories WHERE id = ${id}`;
  revalidatePath("/");
  redirect("/");
}
