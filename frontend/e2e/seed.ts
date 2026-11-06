// Seeds a batch with one student and a published one-question exam through the gateway, as the
// MFA-verified administrator. Shared by the browser specs.
import { adminSession, call } from "./support";

export type Setup = { tenant: string; examId: string; examVersionId: string; questionVersionId: string; questionId: string; questionTitle: string; batchId: string; departmentId: string; roll: string; password: string; roll2: string; password2: string; title: string };

/** A batch with one student and a published one-question exam open in 20 s. */
export async function setUp(run: string, opensInMs = 20_000): Promise<Setup> {
  const admin = await adminSession();
  const tenant = (await call<{ items: { id: string }[] }>("GET", "/tenant/v1/tenants", undefined, admin)).items[0]!.id;
  const department = (await call<{ items: { id: string }[] }>("GET", `/tenant/v1/tenants/${tenant}/departments`, undefined, admin)).items[0]!.id;
  const organization = await call<{ id: string }>("POST", "/tenant/v1/placement-organizations", { code: `E2E${run}`, legal_name: `E2E ${run}` }, admin, 201);
  const placement = await call<{ id: string }>("POST", `/tenant/v1/placement-organizations/${organization.id}/departments`, { code: "E2E", name: "E2E placement" }, admin, 201);
  const batch = await call<{ id: string }>("POST", `/tenant/v1/tenants/${tenant}/batches`, { department_id: department, code: `E2E${run}`, name: `E2E-${run}`, academic_year: "2026-2027" }, admin, 201);
  await new Promise((resolve) => setTimeout(resolve, 5000)); // the batch reaches the user service
  const imported = await call<{ imported: { roll_number: string; password: string }[] }>("POST", `/user/v1/tenants/${tenant}/students/import`, {
    batch_id: batch.id, college_department_id: department, placement_department_id: placement.id,
    students: [{ roll_number: `E2E${run}A`, name: "E2E Student" }, { roll_number: `E2E${run}B`, name: "E2E Classmate" }],
  }, admin, 201);

  const question = await call<{ question: { id: string }; question_version: { id: string; version: number } }>("POST", "/question-bank/v1/questions", {
    slug: `e2e-${run.toLowerCase()}`, title: `E2E sum ${run}`, prompt_markdown: "Print n(n+1)/2.", difficulty: "easy",
    supported_languages: ["python3"], time_limit_ms: 2000, memory_limit_kib: 262144, tags: [],
  }, admin, 201);
  const version = await call<{ id: string; version: number }>("PUT", `/question-bank/v1/question-versions/${question.question_version.id}/tests`, {
    expected_question_version: question.question_version.version,
    tests: [
      { input: "5\n", expected_output: "15\n", sample: true },
      { input: "10\n", expected_output: "55\n", sample: true },
      { input: "1000000\n", expected_output: "500000500000\n", sample: false },
      { input: "1\n", expected_output: "1\n", sample: false },
    ],
  }, admin);
  // Publishing needs a model solution that passes every test (ADR-0047).
  const checks = `/question-bank/v1/question-versions/${version.id}/model-checks`;
  await call("POST", checks, { language: "python3", source: "n = int(input())\nprint(n * (n + 1) // 2)\n" }, admin, 202);
  for (let tries = 0; ; tries++) {
    const done = await call<{ lifecycle_state: string; verdict: string | null }[]>("GET", checks, undefined, admin);
    if (done[0] && done[0].lifecycle_state !== "queued") {
      if (done[0].verdict !== "accepted") throw new Error(`the model solution failed: ${JSON.stringify(done[0])}`);
      break;
    }
    if (tries > 60) throw new Error("the model-solution check never finished");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await call("POST", `/question-bank/v1/question-versions/${version.id}/publish`, { expected_question_version: version.version }, admin);

  const policy = await call<{ id: string; version: number }>("POST", `/assessment/v1/tenants/${tenant}/proctor-policies`, { name: `E2E ${run}` }, admin, 201);
  const policyVersion = await call<{ id: string }>("POST", `/assessment/v1/tenants/${tenant}/proctor-policies/${policy.id}/versions`, { expected_policy_version: policy.version, policy: { seb_required: false } }, admin, 201);
  await call("POST", `/assessment/v1/tenants/${tenant}/proctor-policy-versions/${policyVersion.id}/publish`, {}, admin);
  const exam = await call<{ id: string; version: number }>("POST", `/assessment/v1/tenants/${tenant}/exams`, { external_reference: `E2E-${run}` }, admin, 201);
  const opens = new Date(Date.now() + opensInMs);
  const title = `E2E exam ${run}`;
  const examVersion = await call<{ id: string; opens_at: string; closes_at: string }>("POST", `/assessment/v1/tenants/${tenant}/exams/${exam.id}/versions`, {
    expected_exam_version: exam.version, title, instructions_markdown: "End to end.", opens_at: opens.toISOString().replace(/\.\d+Z$/, "Z"),
    closes_at: new Date(opens.getTime() + 2 * 3600_000).toISOString().replace(/\.\d+Z$/, "Z"), duration_seconds: 3600, proctor_policy_version_id: policyVersion.id,
  }, admin, 201);
  const path = `/assessment/v1/tenants/${tenant}/exam-versions/${examVersion.id}`;
  const content = async () => (await call<{ content_version: number }>("GET", path, undefined, admin)).content_version;
  const section = await call<{ id: string }>("POST", `${path}/sections`, { expected_content_version: await content(), position: 1, title: "Coding", instructions_markdown: "", time_limit_seconds: null }, admin, 201);
  await call("POST", `${path}/sections/${section.id}/items`, { expected_content_version: await content(), position: 1, question_version_id: version.id, maximum_score: "10" }, admin, 201);
  await call("POST", `${path}/publish`, { expected_content_version: await content() }, admin);
  await call("POST", `${path}/assignment-rules`, { target_type: "batch", target_id: batch.id, available_from: examVersion.opens_at, available_until: examVersion.closes_at, accommodations: {} }, admin, 201);
  return { tenant, examVersionId: examVersion.id, questionVersionId: version.id, questionId: question.question.id, questionTitle: `E2E sum ${run}`, batchId: batch.id, departmentId: department, examId: exam.id, roll: imported.imported[0]!.roll_number, password: imported.imported[0]!.password, roll2: imported.imported[1]!.roll_number, password2: imported.imported[1]!.password, title };
}

