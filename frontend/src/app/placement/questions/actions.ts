"use server";

import { revalidatePath } from "next/cache";
import { type CreatedDraft, type NewQuestion, writeNewQuestionDraft } from "@/lib/server/question-drafts";
import { requirePlacement } from "@/lib/server/placement";

export type { CreatedDraft, NewQuestion };

/** Placement officers write into the shared question bank (ADR-0089). */
export async function createDraft(input: NewQuestion): Promise<CreatedDraft> {
  await requirePlacement();
  const result = await writeNewQuestionDraft(input);
  revalidatePath("/placement/questions");
  return result;
}
