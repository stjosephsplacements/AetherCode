import "server-only";
import type { QuestionDetail, QuestionVersion } from "@/lib/api-types";
import { isVerified, checkStatus } from "@/lib/model-checks";
import type { ModelCheck } from "@/lib/api-types";
import { cleanTags, prepareTests, explanationsBody } from "@/components/staff/question-wizard/model";
import { gateway } from "@/lib/server/gateway";
import { listCategories, createCategoryByName } from "@/lib/server/categories";
import { type IntakeExportQuestion, recordIntakeBankLink } from "@/lib/server/intake";

export type ImportTopicResult = { imported: number; skipped: number; unverified: string[]; errors: string[] };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitModelChecks(versionId: string, deadlineMs: number): Promise<boolean> {
  const stop = Date.now() + deadlineMs;
  while (Date.now() < stop) {
    const checks = await gateway<ModelCheck[]>(`/question-bank/v1/question-versions/${versionId}/model-checks`).catch(() => []);
    if (isVerified(checks)) return true;
    const status = checkStatus(checks);
    if (status === "running" || status === "idle") {
      await sleep(1500);
      continue;
    }
  }
  return false;
}

async function runIntakeModelChecks(versionId: string, question: IntakeExportQuestion): Promise<boolean> {
  for (const solution of question.model_solutions) {
    if (!solution.source.trim()) continue;
    await gateway(`/question-bank/v1/question-versions/${versionId}/model-checks`, {
      method: "POST",
      body: { language: solution.language, source: solution.source },
    });
  }
  if (question.kind === "mcq") return true;
  return question.model_solutions.length === 0 || (await waitModelChecks(versionId, 120_000));
}

async function resolveCategory(topicName: string, parentName: string | null): Promise<string> {
  const categories = await listCategories();
  const parent = parentName ? categories.find((entry) => entry.name === parentName && !entry.parent_id) : undefined;
  const target = categories.find((entry) => entry.name === topicName && (parent ? entry.parent_id === parent.id : !entry.parent_id));
  if (target) return target.id;
  if (parentName && !parent) {
    const parentCategory = await createCategoryByName(parentName);
    return createCategoryByName(topicName, parentCategory.id);
  }
  return createCategoryByName(topicName, parent?.id);
}

async function importOne(question: IntakeExportQuestion, categoryId: string, idempotencyKey: string): Promise<{ ok: boolean; versionId?: string; questionId?: string; skipped?: boolean; error?: string; verified?: boolean }> {
  if (question.bank_link) return { ok: true, skipped: true };
  const mcq = question.kind === "mcq";
  if (!mcq && question.tests.length === 0) return { ok: false, error: "no tests" };
  if (mcq && (!question.choices?.length || !question.correct_choices?.length)) return { ok: false, error: "incomplete mcq" };

  let created: QuestionDetail;
  try {
    created = await gateway<QuestionDetail>("/question-bank/v1/questions", {
      method: "POST",
      body: {
        slug: question.slug,
        title: question.title,
        prompt_markdown: question.prompt_markdown,
        difficulty: question.difficulty,
        supported_languages: mcq ? [] : question.supported_languages,
        time_limit_ms: question.time_limit_ms,
        memory_limit_kib: question.memory_limit_kib,
        tags: cleanTags(question.tags ?? []),
        category_id: categoryId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "create failed";
    if (message.toLowerCase().includes("slug")) return { ok: false, error: `slug ${question.slug} already exists` };
    return { ok: false, error: message };
  }

  const version = created.question_version;
  try {
    if (mcq) {
      await gateway<QuestionVersion>(`/question-bank/v1/question-versions/${version.id}/choices`, {
        method: "PUT",
        body: {
          expected_question_version: version.version,
          choices: question.choices!.map((option) => option.trim()),
          correct_choices: question.correct_choices!,
          multiple_choice: question.multiple_choice,
          explanations: explanationsBody({
            options: question.choices!,
            correct: question.correct_choices!,
            multiple: question.multiple_choice,
            explanations: (question.choice_explanations ?? question.choices!.map(() => "")).map((entry) => entry ?? ""),
          }),
        },
      });
    } else {
      await gateway<QuestionVersion>(`/question-bank/v1/question-versions/${version.id}/tests`, {
        method: "PUT",
        body: { expected_question_version: version.version, tests: prepareTests(question.tests.map((test) => ({ input: test.input, expected_output: test.expected_output, sample: test.sample, weight: test.weight }))) },
      });
      if (question.templates.length > 0) {
        const templates = Object.fromEntries(question.templates.map((row) => [row.language, { starter: row.starter, prefix: row.prefix, suffix: row.suffix }]));
        await gateway(`/question-bank/v1/question-versions/${version.id}/templates`, { method: "PUT", body: { templates } });
      }
    }
    await gateway(`/question-bank/v1/questions/${created.question.id}/audience`, { method: "PUT", body: { audience: question.audience } });
    const verified = await runIntakeModelChecks(version.id, question);
    await recordIntakeBankLink(question.intake_question_id, {
      bank_question_id: created.question.id,
      bank_version_id: version.id,
      idempotency_key: `${idempotencyKey}:${question.intake_question_id}`,
    });
    return { ok: true, versionId: version.id, questionId: created.question.id, verified };
  } catch (error) {
    return { ok: false, versionId: version.id, questionId: created.question.id, error: error instanceof Error ? error.message : "save failed" };
  }
}

export async function importIntakeTopicBundle(
  topicName: string,
  parentName: string | null,
  questions: IntakeExportQuestion[],
  idempotencyKey: string,
): Promise<ImportTopicResult> {
  if (questions.length === 0) return { imported: 0, skipped: 0, unverified: [], errors: ["The topic has no saved questions."] };
  if (questions.length > 100) return { imported: 0, skipped: 0, unverified: [], errors: ["Import at most 100 questions at a time."] };
  const categoryId = await resolveCategory(topicName, parentName);
  let imported = 0;
  let skipped = 0;
  const unverified: string[] = [];
  const errors: string[] = [];
  for (const question of questions) {
    const result = await importOne(question, categoryId, idempotencyKey);
    if (result.skipped) {
      skipped += 1;
      continue;
    }
    if (!result.ok) {
      errors.push(`${question.title} (${result.error ?? "failed"})`);
      continue;
    }
    imported += 1;
    if (question.kind === "coding" && !result.verified) unverified.push(question.title);
  }
  return { imported, skipped, unverified, errors };
}