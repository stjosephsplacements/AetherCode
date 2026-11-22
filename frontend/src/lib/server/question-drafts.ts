import "server-only";
import type { ActionState } from "@/components/staff/form";
import {
  type Choices,
  type Details,
  type TestDraft,
  choicesProblem,
  cleanTags,
  detailsProblem,
  explanationsBody,
  prepareTests,
  slugOf,
  testsProblem,
} from "@/components/staff/question-wizard/model";
import type { QuestionDetail, QuestionVersion } from "@/lib/api-types";
import { listCategories } from "@/lib/server/categories";
import { actionError } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";

export type NewQuestion = { details: Details; tests?: TestDraft[]; choices?: Choices };
export type CreatedDraft = ActionState & { versionId?: string };

/** Writes a new draft into the shared question bank. Caller enforces who may author. */
export async function writeNewQuestionDraft(input: NewQuestion): Promise<CreatedDraft> {
  const { details } = input;
  const mcq = details.kind === "mcq";
  const categorised = (await listCategories()).length > 0;
  const problem =
    detailsProblem(details, { categories: categorised }) ??
    (mcq
      ? choicesProblem(input.choices ?? { options: [], correct: [], multiple: false, explanations: [] })
      : testsProblem(input.tests ?? []));
  if (problem) return { error: problem };

  let created: QuestionDetail;
  try {
    created = await gateway<QuestionDetail>("/question-bank/v1/questions", {
      method: "POST",
      body: {
        slug: slugOf(details),
        title: details.title.trim(),
        prompt_markdown: details.prompt,
        difficulty: details.difficulty,
        supported_languages: mcq ? [] : details.languages,
        time_limit_ms: mcq ? 2000 : Math.round(details.timeSeconds * 1000),
        memory_limit_kib: mcq ? 256 * 1024 : Math.round(details.memoryMb * 1024),
        tags: cleanTags(details.tags),
        ...(categorised ? { category_id: details.categoryId } : {}),
      },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  const version = created.question_version;
  try {
    if (mcq) {
      const choices = input.choices!;
      await gateway<QuestionVersion>(`/question-bank/v1/question-versions/${version.id}/choices`, {
        method: "PUT",
        body: {
          expected_question_version: version.version,
          choices: choices.options.map((option) => option.trim()),
          correct_choices: choices.correct,
          multiple_choice: choices.multiple,
          explanations: explanationsBody(choices),
        },
      });
    } else {
      await gateway<QuestionVersion>(`/question-bank/v1/question-versions/${version.id}/tests`, {
        method: "PUT",
        body: { expected_question_version: version.version, tests: prepareTests(input.tests!) },
      });
    }
  } catch (error) {
    return {
      error: `The draft was created, but its ${mcq ? "options were" : "tests were"} not saved: ${actionError(error)}`,
      versionId: version.id,
    };
  }
  return { error: null, versionId: version.id };
}
