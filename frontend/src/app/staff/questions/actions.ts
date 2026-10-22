"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/staff/form";
import type { Audience, QuestionDetail, QuestionVersion } from "@/lib/api-types";
import { actionError } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";
import { requireStaff } from "@/lib/server/staff";

/** The version fields shared by a new question and a new draft version. */
function versionContent(form: FormData) {
  return {
    title: String(form.get("title") ?? "").trim(),
    prompt_markdown: String(form.get("prompt_markdown") ?? ""),
    difficulty: String(form.get("difficulty") ?? "easy"),
    supported_languages: form.getAll("languages").map(String),
    time_limit_ms: Math.round(Number(form.get("time_limit_seconds") ?? 2) * 1000),
    memory_limit_kib: Math.round(Number(form.get("memory_limit_mb") ?? 256) * 1024),
    tags: [],
  };
}

export async function createQuestion(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireStaff();
  const content = versionContent(form);
  // A multiple-choice question has no languages (ADR-0035); its draft is
  // recognised by that until its options are saved.
  if (form.get("kind") === "mcq") content.supported_languages = [];
  else if (content.supported_languages.length === 0) return { error: "Choose at least one language." };
  const slug =
    String(form.get("slug") ?? "").trim() ||
    content.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  let created: QuestionDetail;
  try {
    created = await gateway<QuestionDetail>("/question-bank/v1/questions", { method: "POST", body: { slug, ...content } });
  } catch (error) {
    return { error: actionError(error) };
  }
  redirect(`/staff/questions/${created.question_version.id}`);
}

export type Test = { input: string; expected_output: string; sample: boolean; weight: number };

export async function saveTests(versionId: string, expectedVersion: number, tests: Test[]): Promise<ActionState> {
  await requireStaff();
  if (!tests.some((test) => test.sample)) return { error: "Mark at least one test as a sample, so students can run their code." };
  if (!tests.some((test) => !test.sample)) return { error: "Add at least one hidden test. Hidden tests decide the marks." };
  try {
    await gateway<QuestionVersion>(`/question-bank/v1/question-versions/${versionId}/tests`, {
      method: "PUT",
      body: { expected_question_version: expectedVersion, tests },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath(`/staff/questions/${versionId}`);
  return { error: null, message: `${tests.length} tests saved and encrypted.` };
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
export async function startModelCheck(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireStaff();
  const versionId = String(form.get("version_id") ?? "");
  const source = String(form.get("source") ?? "");
  if (!source.trim()) return { error: "Paste a solution first." };
  try {
    await gateway(`/question-bank/v1/question-versions/${versionId}/model-checks`, {
      method: "POST",
      body: { language: String(form.get("language") ?? ""), source },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath(`/staff/questions/${versionId}`);
  return { error: null, message: "Running on every test. Results appear below in a few seconds." };
}

/** Options and answer of a multiple-choice draft (ADR-0035). */
export async function saveChoices(versionId: string, expectedVersion: number, choices: string[], correct: number[], multiple: boolean): Promise<ActionState> {
  await requireStaff();
  const options = choices.map((choice) => choice.trim());
  if (options.length < 2 || options.some((option) => !option)) return { error: "Give at least two options, none empty." };
  if (correct.length === 0) return { error: "Mark the correct answer." };
  if (!multiple && correct.length > 1) return { error: "A single-answer question has one correct option." };
  try {
    await gateway<QuestionVersion>(`/question-bank/v1/question-versions/${versionId}/choices`, {
      method: "PUT",
      body: { expected_question_version: expectedVersion, choices: options, correct_choices: correct, multiple_choice: multiple },
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
