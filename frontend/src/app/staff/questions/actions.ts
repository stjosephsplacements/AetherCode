"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/staff/form";
import type { Audience, CategoryRef, QuestionDetail, QuestionVersion } from "@/lib/api-types";
import { listCategories } from "@/lib/server/categories";
import { actionError } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";
import { requireStaff } from "@/lib/server/staff";
import { type Choices, type Details, type TestDraft, choicesProblem, cleanTags, detailsProblem, explanationsBody, prepareTests, slugOf, testsProblem } from "@/components/staff/question-wizard/model";

/** What a new question needs: its details, plus its tests (coding) or its options (multiple choice). */
export type NewQuestion = { details: Details; tests?: TestDraft[]; choices?: Choices };
/** versionId is set once the draft exists, even when a later step failed, so the author can carry on there. */
export type CreatedDraft = ActionState & { versionId?: string };

/**
 * Saves a question as a draft in one go: the details first, then the tests or
 * the options. Everything was already checked in the browser; this checks it again.
 */
export async function createDraft(input: NewQuestion): Promise<CreatedDraft> {
  await requireStaff();
  const { details } = input;
  const mcq = details.kind === "mcq";
  // A question bank from before categories has none to choose, and rejects the field.
  const categorised = (await listCategories()).length > 0;
  const problem = detailsProblem(details, { categories: categorised }) ?? (mcq ? choicesProblem(input.choices ?? { options: [], correct: [], multiple: false, explanations: [] }) : testsProblem(input.tests ?? []));
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
        // A multiple-choice question has no languages (ADR-0035); its draft is
        // recognised by that until its options are saved.
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
        body: { expected_question_version: version.version, choices: choices.options.map((option) => option.trim()), correct_choices: choices.correct, multiple_choice: choices.multiple, explanations: explanationsBody(choices) },
      });
    } else {
      await gateway<QuestionVersion>(`/question-bank/v1/question-versions/${version.id}/tests`, {
        method: "PUT",
        body: { expected_question_version: version.version, tests: prepareTests(input.tests!) },
      });
    }
  } catch (error) {
    revalidatePath("/staff/questions");
    return { error: `The draft was created, but its ${mcq ? "options were" : "tests were"} not saved: ${actionError(error)}`, versionId: version.id };
  }
  revalidatePath("/staff/questions");
  return { error: null, versionId: version.id };
}

export type Test = TestDraft;

/** Replaces every test of a draft; the old ones are encrypted and cannot be read back. */
export async function saveTests(versionId: string, expectedVersion: number, tests: Test[]): Promise<ActionState> {
  await requireStaff();
  const problem = testsProblem(tests);
  if (problem) return { error: problem };
  try {
    await gateway<QuestionVersion>(`/question-bank/v1/question-versions/${versionId}/tests`, {
      method: "PUT",
      body: { expected_question_version: expectedVersion, tests: prepareTests(tests) },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath(`/staff/questions/${versionId}`);
  return { error: null, message: `${tests.length} tests saved. Run your solution again to verify them.` };
}

export async function publishQuestion(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireStaff();
  const versionId = String(form.get("version_id"));
  try {
    await gateway(`/question-bank/v1/question-versions/${versionId}/publish`, {
      method: "POST",
      body: { expected_question_version: Number(form.get("expected_version")) },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath(`/staff/questions/${versionId}`);
  revalidatePath("/staff/questions");
  return { error: null, message: "Published. Faculty in every college can now add it to exams." };
}

export async function requestReview(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireStaff();
  const versionId = String(form.get("version_id"));
  try {
    await gateway(`/question-bank/v1/question-versions/${versionId}/request-review`, {
      method: "POST",
      body: { expected_question_version: Number(form.get("expected_version")), reviewer_id: String(form.get("reviewer_id") ?? "") },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath(`/staff/questions/${versionId}`);
  revalidatePath("/staff/questions");
  return { error: null, message: "Sent for review. Another member of staff can now approve it." };
}

/** Starts an editable draft from a published question, copying its content. */
export async function draftNewVersion(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireStaff();
  const questionId = String(form.get("question_id"));
  let created: QuestionDetail;
  try {
    const current = await gateway<QuestionDetail>(`/question-bank/v1/questions/${questionId}`);
    const version = current.question_version;
    created = await gateway<QuestionDetail>(`/question-bank/v1/questions/${questionId}/versions`, {
      method: "POST",
      body: {
        expected_question_revision: current.question.version,
        title: version.title,
        prompt_markdown: version.prompt_markdown,
        difficulty: version.difficulty,
        supported_languages: version.supported_languages,
        time_limit_ms: version.time_limit_ms,
        memory_limit_kib: version.memory_limit_kib,
        tags: [],
      },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  redirect(`/staff/questions/${created.question_version.id}`);
}

const EXPORT_FORMAT = "aethercode.question.v1";

type QuestionFile = {
  format: string;
  title: string;
  prompt_markdown: string;
  difficulty: string;
  supported_languages: string[];
  time_limit_ms: number;
  memory_limit_kib: number;
  tests: Test[];
};

/**
 * A new draft from an exported question file (ADR-0032). The question bank
 * validates every field as it would for a hand-written question; the draft is
 * then checked and published as usual.
 */
export async function importQuestion(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireStaff();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an exported question file." };
  if (file.size > 250 * 1024 * 1024) return { error: "The file is larger than any exported question." };
  let question: QuestionFile;
  try {
    question = JSON.parse(await file.text()) as QuestionFile;
  } catch {
    return { error: "The file is not a question export." };
  }
  if ((question as unknown as { format?: string })?.format === V1_FORMAT) return importV1Questions(question as unknown as V1File);
  if (question?.format !== EXPORT_FORMAT || !Array.isArray(question.tests)) return { error: "The file is not a question export." };
  const slug = `${question.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50)}-${crypto.randomUUID().slice(0, 6)}`;
  let created: QuestionDetail;
  try {
    created = await gateway<QuestionDetail>("/question-bank/v1/questions", {
      method: "POST",
      body: {
        slug,
        title: question.title,
        prompt_markdown: question.prompt_markdown,
        difficulty: question.difficulty,
        supported_languages: question.supported_languages,
        time_limit_ms: question.time_limit_ms,
        memory_limit_kib: question.memory_limit_kib,
        tags: [],
      },
    });
    await gateway<QuestionVersion>(`/question-bank/v1/question-versions/${created.question_version.id}/tests`, {
      method: "PUT",
      body: {
        expected_question_version: created.question_version.version,
        tests: question.tests.map(({ input, expected_output, sample, weight }) => ({ input, expected_output, sample, weight })),
      },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/questions");
  redirect(`/staff/questions/${created.question_version.id}`);
}

/** Run an author's reference solution on every test of a version (ADR-0033). */
/** Runs a reference solution on every test of a draft, hidden ones included (ADR-0033). */
export async function runModelCheck(versionId: string, language: string, source: string): Promise<ActionState> {
  await requireStaff();
  if (!source.trim()) return { error: "Write a solution first." };
  if (new TextEncoder().encode(source).length > 64 * 1024) return { error: "A solution can be at most 64 KB." };
  try {
    await gateway(`/question-bank/v1/question-versions/${versionId}/model-checks`, { method: "POST", body: { language, source } });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath(`/staff/questions/${versionId}`);
  return { error: null, message: "Running on every test." };
}

/** Options and answer of a multiple-choice draft (ADR-0035). */
export async function saveChoices(versionId: string, expectedVersion: number, choices: string[], correct: number[], multiple: boolean, explanations?: (string | null)[]): Promise<ActionState> {
  await requireStaff();
  const options = choices.map((choice) => choice.trim());
  if (options.length < 2 || options.some((option) => !option)) return { error: "Give at least two options, none empty." };
  if (correct.length === 0) return { error: "Mark the correct answer." };
  if (!multiple && correct.length > 1) return { error: "A single-answer question has one correct option." };
  try {
    await gateway<QuestionVersion>(`/question-bank/v1/question-versions/${versionId}/choices`, {
      method: "PUT",
      body: { expected_question_version: expectedVersion, choices: options, correct_choices: correct, multiple_choice: multiple, explanations },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath(`/staff/questions/${versionId}`);
  return { error: null, message: "Options saved." };
}

/** The exam app's question file (apps/exam-v1, faculty → questions → export). */
const V1_FORMAT = "aethercode-questions";
/** The exam app set languages per exam; its questions get its four. */
const V1_LANGUAGES = ["c", "cpp17", "java", "python3"];

type V1File = {
  format: string;
  version: number;
  questions: {
    title: string;
    kind: "coding" | "mcq";
    statement: string;
    timeLimitMs: number;
    memoryLimitMb: number;
    options: string[];
    correct: number[];
    tests: { input: string; expectedOutput: string; isSample: boolean; weight: number }[];
  }[];
};

/** Each question of an exam-app file becomes a draft here, coding or multiple choice. */
async function importV1Questions(file: V1File): Promise<ActionState> {
  if (file.version !== 1 || !Array.isArray(file.questions) || file.questions.length === 0) return { error: "The exam-app file is empty or from an unknown version." };
  if (file.questions.length > 100) return { error: "Import at most 100 questions at a time." };
  const failed: string[] = [];
  for (const question of file.questions) {
    const mcq = question.kind === "mcq";
    try {
      const created = await gateway<QuestionDetail>("/question-bank/v1/questions", {
        method: "POST",
        body: {
          slug: `${question.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50)}-${crypto.randomUUID().slice(0, 6)}`,
          title: question.title,
          prompt_markdown: question.statement,
          difficulty: "medium",
          supported_languages: mcq ? [] : V1_LANGUAGES,
          time_limit_ms: Math.min(600_000, Math.max(50, question.timeLimitMs || 2000)),
          memory_limit_kib: Math.min(4_194_304, Math.max(1024, (question.memoryLimitMb || 256) * 1024)),
          tags: [],
        },
      });
      const version = created.question_version;
      if (mcq) {
        await gateway(`/question-bank/v1/question-versions/${version.id}/choices`, {
          method: "PUT",
          body: { expected_question_version: version.version, choices: question.options, correct_choices: question.correct, multiple_choice: question.correct.length > 1 },
        });
      } else if (question.tests.length > 0) {
        await gateway(`/question-bank/v1/question-versions/${version.id}/tests`, {
          method: "PUT",
          body: {
            expected_question_version: version.version,
            tests: question.tests.map((test) => ({ input: test.input, expected_output: test.expectedOutput, sample: test.isSample, weight: test.weight || 1 })),
          },
        });
      }
    } catch (error) {
      failed.push(`${question.title} (${actionError(error)})`);
    }
  }
  revalidatePath("/staff/questions");
  const imported = file.questions.length - failed.length;
  if (failed.length) return { error: `Imported ${imported} of ${file.questions.length}. Not imported: ${failed.join("; ")}` };
  return { error: null, message: `Imported ${imported} question${imported === 1 ? "" : "s"} as drafts. Check each and publish it from My drafts.` };
}

/** Moves a question between tests and practice (ADR-0041). */
export async function setAudience(questionId: string, versionId: string, audience: Audience): Promise<ActionState> {
  await requireStaff();
  try {
    await gateway(`/question-bank/v1/questions/${questionId}/audience`, { method: "PUT", body: { audience } });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath(`/staff/questions/${versionId}`);
  revalidatePath("/staff/questions");
  return {
    error: null,
    message: audience === "practice" ? "Now a practice problem: students can see and solve it." : "Now a test question: hidden from practice.",
  };
}

/** Adds a category, or finds the one with that name among its siblings (ADR-0052). `parentId` files it as a sub-category (ADR-0058). Open to every author. */
export async function createCategory(name: string, parentId?: string): Promise<ActionState & { category?: CategoryRef }> {
  await requireStaff();
  try {
    const result = await gateway<CategoryRef>("/question-bank/v1/categories", { method: "POST", body: { name, ...(parentId ? { parent_id: parentId } : {}) } });
    revalidatePath("/staff/questions");
    return { error: null, category: { id: result.id, name: result.name, parent_id: result.parent_id ?? null } };
  } catch (error) {
    return { error: actionError(error) };
  }
}

/** Renaming, merging and deleting re-file every college's questions: administrators only. */
async function requireCategoryAdmin() {
  const staff = await requireStaff();
  return staff.canManageAccounts ? null : ({ error: "Only an administrator can rename, merge or delete categories." } satisfies ActionState);
}

/** Renames a category, moves it under `parentId` (null for top level), or both (ADR-0058). */
export async function updateCategory(id: string, changes: { name?: string; parentId?: string | null }): Promise<ActionState> {
  const refused = await requireCategoryAdmin();
  if (refused) return refused;
  const body: { name?: string; parent_id?: string | null } = {};
  if (changes.name !== undefined) body.name = changes.name;
  if (changes.parentId !== undefined) body.parent_id = changes.parentId;
  try {
    await gateway(`/question-bank/v1/categories/${id}`, { method: "PATCH", body });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/questions");
  return { error: null, message: "Saved." };
}

/** Deletes a category; its questions move to `moveTo`, or to Uncategorised. */
export async function deleteCategory(id: string, moveTo: string): Promise<ActionState> {
  const refused = await requireCategoryAdmin();
  if (refused) return refused;
  try {
    const result = await gateway<{ moved: number }>(`/question-bank/v1/categories/${id}${moveTo ? `?move_to=${encodeURIComponent(moveTo)}` : ""}`, { method: "DELETE" });
    revalidatePath("/staff/questions");
    return { error: null, message: result.moved === 1 ? "Deleted. 1 question moved." : `Deleted. ${result.moved} questions moved.` };
  } catch (error) {
    return { error: actionError(error) };
  }
}

/** Files a question under a category and sets its tags, on any version state (ADR-0052). */
export async function saveOrganisation(questionId: string, versionId: string, categoryId: string, tags: string[]): Promise<ActionState> {
  await requireStaff();
  try {
    await gateway(`/question-bank/v1/questions/${questionId}/category`, { method: "PUT", body: { category_id: categoryId } });
    await gateway(`/question-bank/v1/questions/${questionId}/tags`, { method: "PUT", body: { tags: cleanTags(tags) } });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath(`/staff/questions/${versionId}`);
  revalidatePath("/staff/questions");
  return { error: null, message: "Saved." };
}

const REASON = "A reason is needed to delete anything.";

/** Deletes a question that was never published. The database refuses one that was, because exams pin it (ADR-0053). */
export async function deleteQuestion(questionId: string, reason: string): Promise<ActionState> {
  await requireStaff();
  if (!reason.trim()) return { error: REASON };
  try {
    await gateway(`/question-bank/v1/questions/${questionId}`, { method: "DELETE", body: { reason: reason.trim() } });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/questions");
  return { error: null, message: "Deleted." };
}

/** Deletes one draft version; a published one is refused. The question goes with its last version. */
export async function deleteDraftVersion(versionId: string, reason: string): Promise<ActionState> {
  await requireStaff();
  if (!reason.trim()) return { error: REASON };
  try {
    await gateway(`/question-bank/v1/question-versions/${versionId}`, { method: "DELETE", body: { reason: reason.trim() } });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/questions");
  return { error: null, message: "Deleted." };
}

/** Edits a draft's title, statement, difficulty or limits. A published version is refused (ADR-0054). */
export async function updateQuestionDetails(versionId: string, expectedVersion: number, changes: Record<string, string>): Promise<ActionState> {
  await requireStaff();
  const body: Record<string, string | number> = { expected_question_version: expectedVersion };
  if ("title" in changes) body.title = changes.title!.trim();
  if ("prompt" in changes) body.prompt_markdown = changes.prompt!.trim();
  if ("difficulty" in changes) body.difficulty = changes.difficulty!;
  if ("time_seconds" in changes) body.time_limit_ms = Math.round(Number(changes.time_seconds) * 1000);
  if ("memory_mb" in changes) body.memory_limit_kib = Math.round(Number(changes.memory_mb) * 1024);
  try {
    await gateway(`/question-bank/v1/question-versions/${versionId}`, { method: "PATCH", body });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/staff/questions");
  revalidatePath(`/staff/questions/${versionId}`);
  return { error: null, message: "Saved." };
}
