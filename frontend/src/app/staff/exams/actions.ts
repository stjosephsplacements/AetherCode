"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/staff/form";
import type { Exam, ExamVersion, ExamVersionContent, Page, ProctorPolicy, ProctorPolicyVersion, QuestionVersion } from "@/lib/api-types";
import { actionError } from "@/lib/server/actions";
import { PREVIEW_PREFIX, copyExam } from "@/lib/server/exams";
import { gateway } from "@/lib/server/gateway";
import { requireCollege } from "@/lib/server/staff";
import { collegeTimeToISO } from "@/lib/utils";

const STANDARD_POLICY = "Standard";

/**
 * Every exam version names a published proctor policy version. Lab lockdown
 * is set per exam (Safe Exam Browser), so one standard policy per college
 * suffices; it is created the first time it is needed.
 */
async function standardPolicyVersion(tenantId: string): Promise<string> {
  const base = `/assessment/v1/tenants/${tenantId}`;
  const policies = (await gateway<Page<ProctorPolicy>>(`${base}/proctor-policies?limit=100`)).items;
  for (const policy of policies) {
    const versions = (await gateway<Page<ProctorPolicyVersion>>(`${base}/proctor-policies/${policy.id}/versions?limit=100`)).items;
    const published = versions.find((version) => version.status === "published");
    if (published) return published.id;
  }
  const policy = await gateway<ProctorPolicy>(`${base}/proctor-policies`, { method: "POST", body: { name: STANDARD_POLICY } });
  const version = await gateway<ProctorPolicyVersion>(`${base}/proctor-policies/${policy.id}/versions`, {
    method: "POST",
    body: { expected_policy_version: policy.version, policy: { seb_required: false } },
  });
  await gateway(`${base}/proctor-policy-versions/${version.id}/publish`, { method: "POST", body: {} });
  return version.id;
}

export async function createExam(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  const base = `/assessment/v1/tenants/${tenantId}`;
  let examId: string;
  try {
    const opensAt = collegeTimeToISO(String(form.get("opens_at")));
    const closesAt = collegeTimeToISO(String(form.get("closes_at")));
    if (Date.parse(closesAt) <= Date.parse(opensAt)) return { error: "The window must close after it opens." };
    const policyVersionId = await standardPolicyVersion(tenantId);
    const exam = await gateway<Exam>(`${base}/exams`, { method: "POST", body: {} });
    const version = await gateway<ExamVersion>(`${base}/exams/${exam.id}/versions`, {
      method: "POST",
      body: {
        expected_exam_version: exam.version,
        title: String(form.get("title") ?? "").trim(),
        instructions_markdown: String(form.get("instructions_markdown") ?? "").trim() || "Solve every question. Your code saves automatically.",
        opens_at: opensAt,
        closes_at: closesAt,
        duration_seconds: Math.round(Number(form.get("duration_minutes")) * 60),
        proctor_policy_version_id: policyVersionId,
      },
    });
    await gateway(`${base}/exam-versions/${version.id}/sections`, {
      method: "POST",
      body: { expected_content_version: version.content_version, position: 1, title: "Questions", instructions_markdown: "", time_limit_seconds: null },
    });
    examId = exam.id;
  } catch (error) {
    return { error: error instanceof Error && !("status" in error) ? error.message : actionError(error) };
  }
  redirect(`/staff/exams/${examId}`);
}

export async function addQuestion(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  const base = `/assessment/v1/tenants/${tenantId}/exam-versions/${String(form.get("version_id"))}`;
  try {
    const version = await gateway<ExamVersion>(base);
    const content = await gateway<ExamVersionContent>(`${base}/content`);
    const chosen = String(form.get("section_id") ?? "");
    let section = content.sections.find((candidate) => candidate.id === chosen) ?? content.sections[0];
    let contentVersion = version.content_version;
    if (!section) {
      const created = await gateway<{ id: string }>(`${base}/sections`, {
        method: "POST",
        body: { expected_content_version: contentVersion, position: 1, title: "Questions", instructions_markdown: "", time_limit_seconds: null },
      });
      section = { id: created.id, position: 1, title: "Questions", draw_count: null, items: [] };
      contentVersion += 1;
    }
    const question = await gateway<QuestionVersion>(`/question-bank/v1/question-versions/${String(form.get("question_version_id"))}`);
    await gateway(`${base}/sections/${section.id}/items`, {
      method: "POST",
      body: {
        expected_content_version: contentVersion,
        position: section.items.length + 1,
        question_version_id: question.id,
        maximum_score: String(Number(form.get("maximum_score")) || 10),
      },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath(`/staff/exams/${String(form.get("exam_id"))}`);
  return { error: null, message: "Question added." };
}

export async function publishExam(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  const base = `/assessment/v1/tenants/${tenantId}/exam-versions/${String(form.get("version_id"))}`;
  try {
    const version = await gateway<ExamVersion>(base);
    await gateway(`${base}/publish`, { method: "POST", body: { expected_content_version: version.content_version } });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath(`/staff/exams/${String(form.get("exam_id"))}`);
  revalidatePath("/staff/exams");
  return { error: null, message: "Published. Now assign it to students." };
}

export async function assignExam(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  const targetType = String(form.get("target_type"));
  try {
    await gateway(`/assessment/v1/tenants/${tenantId}/exam-versions/${String(form.get("version_id"))}/assignment-rules`, {
      method: "POST",
      body: {
        target_type: targetType,
        target_id: String(form.get(`target_${targetType}`) ?? ""),
        available_from: collegeTimeToISO(String(form.get("available_from"))),
        available_until: collegeTimeToISO(String(form.get("available_until"))),
        accommodations: {},
      },
    });
  } catch (error) {
    return { error: error instanceof Error && !("status" in error) ? error.message : actionError(error) };
  }
  revalidatePath(`/staff/exams/${String(form.get("exam_id"))}`);
  return { error: null, message: "Assigned. Students see the exam on their dashboard within a few seconds." };
}

export async function saveSebPolicy(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  const keys = String(form.get("accepted_keys") ?? "")
    .split(/[\s,]+/)
    .map((key) => key.trim().toLowerCase())
    .filter(Boolean);
  const networks = String(form.get("allowed_networks") ?? "")
    .split(/[\s,]+/)
    .map((network) => network.trim())
    .filter(Boolean);
  const enabled = form.get("enabled") === "on";
  if (enabled && keys.length === 0) return { error: "Add the Browser Exam Key or Config Key from the lab's Safe Exam Browser." };
  if (keys.some((key) => !/^[0-9a-f]{64}$/.test(key))) return { error: "Each key is 64 hexadecimal characters." };
  try {
    await gateway(`/seb/v1/tenants/${tenantId}/exams/${String(form.get("exam_id"))}/seb-policy`, {
      method: "PUT",
      body: { title: String(form.get("title") ?? "Exam"), enabled, accepted_keys: keys, allowed_networks: networks },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath(`/staff/exams/${String(form.get("exam_id"))}`);
  const where = networks.length ? ` Students can sit it only from ${networks.length === 1 ? "that network" : "those networks"}.` : "";
  return { error: null, message: (enabled ? "Locked to Safe Exam Browser." : "Safe Exam Browser lock is off.") + where };
}

/**
 * A new draft exam with the source's instructions, duration, policy and
 * questions with their marks, under a new title and window. Assignments and
 * Safe Exam Browser settings are not copied: the copy is for another sitting.
 */
export async function duplicateExam(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  let examId: string;
  try {
    const opensAt = collegeTimeToISO(String(form.get("opens_at")));
    const closesAt = collegeTimeToISO(String(form.get("closes_at")));
    if (Date.parse(closesAt) <= Date.parse(opensAt)) return { error: "The window must close after it opens." };
    const title = String(form.get("title") ?? "").trim();
    if (title.startsWith(PREVIEW_PREFIX)) return { error: "That title is reserved for previews." };
    examId = (await copyExam(tenantId, String(form.get("version_id")), title, opensAt, closesAt)).exam.id;
  } catch (error) {
    return { error: error instanceof Error && !("status" in error) ? error.message : actionError(error) };
  }
  revalidatePath("/staff/exams");
  redirect(`/staff/exams/${examId}`);
}

/**
 * Lets staff take an exam as a student (ADR-0046): a private copy, open from
 * now for the exam's duration plus ten minutes, assigned to the caller alone.
 * The real exam's attempts, results and statistics are untouched.
 */
export async function tryExam(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { tenantId, viewer } = await requireCollege();
  const base = `/assessment/v1/tenants/${tenantId}`;
  let target: string;
  try {
    const source = await gateway<ExamVersion>(`${base}/exam-versions/${String(form.get("version_id"))}`);
    // The service accepts a window that opened at most a minute ago.
    const opensAt = new Date(Date.now() - 20_000).toISOString();
    const closesAt = new Date(Date.now() + (source.duration_seconds + 600) * 1000).toISOString();
    const { exam, version } = await copyExam(tenantId, source.id, `${PREVIEW_PREFIX}${source.title}`, opensAt, closesAt);
    const copyBase = `${base}/exam-versions/${version.id}`;
    const draft = await gateway<ExamVersion>(copyBase);
    await gateway(`${copyBase}/publish`, { method: "POST", body: { expected_content_version: draft.content_version } });
    const rule = await gateway<{ id: string }>(`${copyBase}/assignment-rules`, {
      method: "POST",
      body: { target_type: "student", target_id: viewer.principalId, available_from: opensAt, available_until: closesAt, accommodations: {} },
    });
    const assignment = await gateway<{ id: string }>(`${base}/assignment-rules/${rule.id}/candidate-assignments`, {
      method: "POST",
      body: { candidate_id: viewer.principalId },
    });
    target = `/staff/exams/${exam.id}/try/${assignment.id}`;
  } catch (error) {
    return { error: error instanceof Error && !("status" in error) ? error.message : actionError(error) };
  }
  redirect(target);
}

/** A pool section: each student gets draw_count of its questions (ADR-0034). */
export async function addPool(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  const base = `/assessment/v1/tenants/${tenantId}/exam-versions/${String(form.get("version_id"))}`;
  const drawCount = Number(form.get("draw_count"));
  if (!Number.isInteger(drawCount) || drawCount < 1 || drawCount > 100) return { error: "A pool gives each student 1 to 100 questions." };
  try {
    const [version, content] = await Promise.all([gateway<ExamVersion>(base), gateway<ExamVersionContent>(`${base}/content`)]);
    await gateway(`${base}/sections`, {
      method: "POST",
      body: {
        expected_content_version: version.content_version,
        position: Math.max(0, ...content.sections.map((section) => section.position)) + 1,
        title: String(form.get("title") ?? "").trim() || "Pool",
        instructions_markdown: "",
        time_limit_seconds: null,
        draw_count: drawCount,
      },
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath(`/staff/exams/${String(form.get("exam_id"))}`);
  return { error: null, message: "Pool added. Add its questions below; give them all the same marks." };
}

/**
 * Regrade one item with a corrected version of its question (ADR-0039):
 * Assessment repins the item and re-sends every assignment, then Submission
 * evaluates every answer of the item again on the corrected tests.
 */
export async function regradeItem(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  const versionId = String(form.get("version_id"));
  const itemId = String(form.get("item_id"));
  try {
    await gateway(`/assessment/v1/tenants/${tenantId}/exam-versions/${versionId}/items/${itemId}/repin`, {
      method: "POST",
      body: { question_version_id: String(form.get("question_version_id")) },
    });
    // The re-sent assignments reach Submission through the event stream; give
    // them a moment before asking it to regrade.
    let result: { evaluations: number; attempts_regrading: number } | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      result = await gateway(`/submission/v1/tenants/${tenantId}/exam-versions/${versionId}/items/${itemId}/regrade`, { method: "POST", body: {} });
      if (result && result.evaluations > 0) break;
    }
    revalidatePath(`/staff/exams/${String(form.get("exam_id"))}`);
    return {
      error: null,
      message: result?.evaluations
        ? `Regrading ${result.evaluations} answer${result.evaluations === 1 ? "" : "s"}; results update as they finish.`
        : "The item now uses the corrected version. No answers needed regrading yet; run it again if students had submitted.",
    };
  } catch (error) {
    return { error: actionError(error) };
  }
}

/** Moves an assignment's close time after publication (ADR-0040). */
export async function moveWindow(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { tenantId } = await requireCollege();
  try {
    const until = collegeTimeToISO(String(form.get("available_until")));
    const { assignments_moved: moved } = await gateway<{ assignments_moved: number }>(
      `/assessment/v1/tenants/${tenantId}/assignment-rules/${String(form.get("rule_id"))}/window`,
      { method: "POST", body: { available_until: until } },
    );
    revalidatePath(`/staff/exams/${String(form.get("exam_id"))}`);
    return { error: null, message: `Moved for ${moved} student${moved === 1 ? "" : "s"}.` };
  } catch (error) {
    return { error: error instanceof Error && !("status" in error) ? error.message : actionError(error) };
  }
}
