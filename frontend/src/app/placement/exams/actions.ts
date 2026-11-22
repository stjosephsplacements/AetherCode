"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/staff/form";
import type { Exam, ExamVersion, ExamVersionContent, ProctorPolicy, ProctorPolicyVersion, QuestionVersion } from "@/lib/api-types";
import { chosenPolicyVersionId } from "@/lib/proctor-policy-body";
import { actionError } from "@/lib/server/actions";
import { gateway } from "@/lib/server/gateway";
import { requirePlacement } from "@/lib/server/placement";
import { listAllProctorPolicies, listProctorPolicyVersions } from "@/lib/server/proctor-policies";
import { collegeTimeToISO } from "@/lib/utils";

const STANDARD_POLICY = "Standard";

async function hostCollege(collegeId: string): Promise<string> {
  const placement = await requirePlacement();
  if (!placement.colleges.some((college) => college.id === collegeId)) {
    throw new Error("That college is outside your reach.");
  }
  return collegeId;
}

async function standardPolicyVersion(tenantId: string): Promise<string> {
  const base = `/assessment/v1/tenants/${tenantId}`;
  const policies = await listAllProctorPolicies(tenantId);
  for (const policy of policies) {
    if (policy.name !== STANDARD_POLICY) continue;
    const published = (await listProctorPolicyVersions(tenantId, policy.id, "published"))[0];
    if (published) return published.id;
  }
  const policy = await gateway<ProctorPolicy>(`${base}/proctor-policies`, { method: "POST", body: { name: STANDARD_POLICY } });
  const version = await gateway<ProctorPolicyVersion>(`${base}/proctor-policies/${policy.id}/versions`, {
    method: "POST",
    body: { expected_policy_version: policy.version, policy: { enabled: false, seb_required: false } },
  });
  await gateway(`${base}/proctor-policy-versions/${version.id}/publish`, { method: "POST", body: {} });
  return version.id;
}

const refresh = (collegeId: string, examId?: string) => {
  revalidatePath("/placement/exams");
  if (examId) revalidatePath(`/placement/exams/${examId}`);
};

/** Create an exam under a host college; assign it to placement tracks on the detail page. */
export async function createPlacementExam(_previous: ActionState, form: FormData): Promise<ActionState> {
  const collegeId = await hostCollege(String(form.get("college_id") ?? "").trim());
  const base = `/assessment/v1/tenants/${collegeId}`;
  let examId: string;
  try {
    const opensAt = collegeTimeToISO(String(form.get("opens_at")));
    const closesAt = collegeTimeToISO(String(form.get("closes_at")));
    if (Date.parse(closesAt) <= Date.parse(opensAt)) return { error: "The window must close after it opens." };
    const policyVersionId = chosenPolicyVersionId(form) || (await standardPolicyVersion(collegeId));
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
  refresh(collegeId, examId);
  redirect(`/placement/exams/${examId}?college=${encodeURIComponent(collegeId)}`);
}

export async function addPlacementQuestion(_previous: ActionState, form: FormData): Promise<ActionState> {
  const collegeId = await hostCollege(String(form.get("college_id") ?? "").trim());
  const examId = String(form.get("exam_id") ?? "");
  const versionId = String(form.get("version_id") ?? "");
  const base = `/assessment/v1/tenants/${collegeId}/exam-versions/${versionId}`;
  try {
    const version = await gateway<ExamVersion>(base);
    const content = await gateway<ExamVersionContent>(`${base}/content`);
    let section = content.sections[0];
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
  refresh(collegeId, examId);
  return { error: null, message: "Question added." };
}

export async function publishPlacementExam(_previous: ActionState, form: FormData): Promise<ActionState> {
  const collegeId = await hostCollege(String(form.get("college_id") ?? "").trim());
  const examId = String(form.get("exam_id") ?? "");
  const versionId = String(form.get("version_id") ?? "");
  try {
    await gateway(`/assessment/v1/tenants/${collegeId}/exam-versions/${versionId}/publish`, { method: "POST", body: {} });
  } catch (error) {
    return { error: actionError(error) };
  }
  refresh(collegeId, examId);
  return { error: null, message: "Published. Assign it to your placement tracks." };
}

/** Assign the exam only to placement departments the officer manages. */
export async function assignPlacementTracks(_previous: ActionState, form: FormData): Promise<ActionState> {
  const placement = await requirePlacement();
  const collegeId = await hostCollege(String(form.get("college_id") ?? "").trim());
  const examId = String(form.get("exam_id") ?? "");
  const versionId = String(form.get("version_id") ?? "");
  const targets = [...new Set(form.getAll("target_id").map(String).filter(Boolean))];
  if (targets.length === 0) return { error: "Tick at least one placement track." };
  for (const targetId of targets) {
    if (!placement.departmentIds.includes(targetId)) {
      return { error: "One of those tracks is outside your assignment." };
    }
  }
  let from: string;
  let until: string;
  try {
    from = collegeTimeToISO(String(form.get("available_from")));
    until = collegeTimeToISO(String(form.get("available_until")));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The window is not valid." };
  }
  let assigned = 0;
  const failed: string[] = [];
  for (const targetId of targets) {
    try {
      await gateway(`/assessment/v1/tenants/${collegeId}/exam-versions/${versionId}/assignment-rules`, {
        method: "POST",
        body: {
          target_type: "placement_department",
          target_id: targetId,
          available_from: from,
          available_until: until,
          accommodations: {},
        },
      });
      assigned++;
    } catch (error) {
      failed.push(`${String(form.get(`label_${targetId}`) ?? targetId.slice(0, 8))}: ${actionError(error)}`);
    }
  }
  refresh(collegeId, examId);
  if (assigned === 0) return { error: failed.slice(0, 3).join(" ") };
  return {
    error: null,
    message: `Assigned to ${assigned} track${assigned === 1 ? "" : "s"}.${failed.length ? ` Skipped: ${failed.slice(0, 2).join("; ")}.` : ""}`,
  };
}
