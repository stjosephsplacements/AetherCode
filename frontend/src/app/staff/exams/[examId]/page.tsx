import { Activity, ArrowLeft, BarChart3, Download, Eye } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Field, Select, TextArea, TextInput } from "@/components/staff/form";
import { EmptyState, LoadError, PageHeader, Section, Table } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import { Badge, Panel } from "@/components/ui/card";
import type { ExamVersionContent, Page, QuestionDetail, QuestionVersion, SebPolicy } from "@/lib/api-types";
import { departmentLabel, listBatches, listDepartments, listPlacement } from "@/lib/server/directory";
import { latestVersion } from "@/lib/server/exams";
import { GatewayError, gateway } from "@/lib/server/gateway";
import { requireCollege } from "@/lib/server/staff";
import { formatDuration, formatScoreText, formatWindow, isoToCollegeTime } from "@/lib/utils";
import { addPool, addQuestion, duplicateExam, publishExam, regradeItem, saveSebPolicy, tryExam } from "../actions";
import { AssignForm } from "./assign-form";
import { MoveWindow } from "./move-window";

export const metadata: Metadata = { title: "Exam" };

const TARGET_LABEL = { batch: "Batch", department: "College department", placement_department: "Placement department", student: "Student" };

async function sebPolicy(tenantId: string, examId: string): Promise<SebPolicy | null> {
  try {
    return await gateway<SebPolicy>(`/seb/v1/tenants/${tenantId}/exams/${examId}/seb-policy`);
  } catch (error) {
    if (error instanceof GatewayError && error.status === 404) return null;
    throw error;
  }
}

export default async function ExamPage({ params }: { params: Promise<{ examId: string }> }) {
  const staff = await requireCollege();
  const { examId } = await params;
  let data;
  try {
    const version = await latestVersion(staff.tenantId, examId);
    if (!version) throw new Error("This exam has no version.");
    const [content, questions, batches, departments, placement, seb] = await Promise.all([
      gateway<ExamVersionContent>(`/assessment/v1/tenants/${staff.tenantId}/exam-versions/${version.id}/content`),
      gateway<Page<QuestionDetail>>("/question-bank/v1/questions?limit=100"),
      listBatches(staff.tenantId),
      listDepartments(staff.tenantId),
      listPlacement(),
      sebPolicy(staff.tenantId, examId),
    ]);
    // For a published exam: items whose question has a newer published version
    // can be regraded with it (ADR-0039).
    const regradable =
      version.status === "draft"
        ? []
        : (
            await Promise.all(
              content.sections
                .flatMap((section) => section.items)
                .map(async (item) => {
                  const pinned = await gateway<QuestionVersion>(`/question-bank/v1/question-versions/${item.question_version_id}`).catch(() => null);
                  if (!pinned || pinned.kind === "mcq") return null;
                  const versions = await gateway<Page<QuestionVersion>>(`/question-bank/v1/questions/${pinned.question_id}/versions?limit=50`).catch(() => null);
                  const newer = (versions?.items ?? []).filter((candidate) => candidate.status === "published" && candidate.version_number > pinned.version_number);
                  return newer.length ? { item, pinned, newer } : null;
                }),
            )
          ).filter((entry) => entry !== null);
    // Practice problems are public to students, so exams use test questions only (ADR-0041).
    data = { version, content, questions: questions.items.filter(({ question }) => question.audience !== "practice"), batches, departments, placement, seb, regradable };
  } catch (error) {
    return (
      <>
        <PageHeader title="Exam" />
        <LoadError error={error} />
      </>
    );
  }
  const { version, content, questions, batches, departments, placement, seb, regradable } = data;
  const draft = version.status === "draft";
  const items = content.sections.flatMap((section) => section.items);
  const sections = content.sections.toSorted((a, b) => a.position - b.position);
  // What each student is marked out of: a pool counts only the questions it draws.
  const total = sections.reduce(
    (sum, section) =>
      sum +
      (section.draw_count
        ? section.draw_count * Number(section.items[0]?.maximum_score ?? 0)
        : section.items.reduce((sectionSum, item) => sectionSum + Number(item.maximum_score), 0)),
    0,
  );
  const targetName = new Map<string, string>([
    ...batches.map((batch) => [batch.id, batch.name] as const),
    ...departments.map((department) => [department.id, departmentLabel(department)] as const),
    ...placement.organizations.flatMap((organization) => organization.departments.map((department) => [department.id, departmentLabel(department)] as const)),
  ]);

  return (
    <>
      <Link href="/staff/exams" className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        Exams
      </Link>
      <PageHeader
        title={version.title}
        description={`${formatWindow(version.opens_at, version.closes_at)}, ${formatDuration(version.duration_seconds)} per student`}
        actions={
          <>
            <Badge tone={draft ? "neutral" : "success"}>{draft ? "Draft" : "Published"}</Badge>
            {items.length > 0 && (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/staff/exams/${examId}/preview`}>
                  <Eye />
                  Preview
                </Link>
              </Button>
            )}
            {!draft && (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/staff/exams/${examId}/monitor`}>
                  <Activity />
                  Live monitor
                </Link>
              </Button>
            )}
            {!draft && (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/staff/exams/${examId}/results`}>
                  <BarChart3 />
                  Results
                </Link>
              </Button>
            )}
          </>
        }
      />

      <Section title={`Questions, ${formatScoreText(total)} marks for each student`}>
        {items.length === 0 && sections.length < 2 ? (
          <EmptyState>No questions yet.</EmptyState>
        ) : (
          <div className="space-y-4">
            {sections.map((section) => (
              <div key={section.id}>
                {sections.length > 1 && (
                  <p className="mb-2 text-[13px] font-medium text-ink-muted">
                    {section.title}
                    {section.draw_count !== null &&
                      `: pool, each student gets ${section.draw_count} of ${section.items.length} question${section.items.length === 1 ? "" : "s"}`}
                  </p>
                )}
                {section.items.length === 0 ? (
                  <EmptyState>No questions in this {section.draw_count !== null ? "pool" : "section"} yet.</EmptyState>
                ) : (
                  <Table head={["#", "Question", "Marks"]}>
                    {section.items.map((item) => (
                      <tr key={item.id}>
                        <td className="w-10 px-4 py-2.5 text-ink-muted">{item.position}</td>
                        <td className="px-4 py-2.5 text-ink">{item.question_title ?? "Question"}</td>
                        <td className="px-4 py-2.5 tabular-nums text-ink">{formatScoreText(Number(item.maximum_score))}</td>
                      </tr>
                    ))}
                  </Table>
                )}
              </div>
            ))}
          </div>
        )}
        {draft && (
          <div className="mt-4 grid gap-4 md:grid-cols-[1.4fr_1fr]">
            <Panel className="p-5">
              <h3 className="mb-4 text-sm font-semibold text-ink">Add a question</h3>
              {questions.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  Publish a question first, in <Link href="/staff/questions" className="text-brand hover:underline">Questions</Link>.
                </p>
              ) : (
                <ActionForm action={addQuestion} submitLabel="Add question">
                  <input type="hidden" name="exam_id" value={examId} />
                  <input type="hidden" name="version_id" value={version.id} />
                  {sections.length > 1 && (
                    <Field label="Into" htmlFor="add-section">
                      <Select id="add-section" name="section_id">
                        {sections.map((section) => (
                          <option key={section.id} value={section.id}>
                            {section.title}
                            {section.draw_count !== null ? ` (pool, ${section.draw_count} each)` : ""}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  <div className="grid grid-cols-[1fr_7rem] gap-3">
                    <Field label="Published question" htmlFor="add-question">
                      <Select id="add-question" name="question_version_id" required>
                        {questions.map(({ question_version: question }) => (
                          <option key={question.id} value={question.id}>
                            {question.title} ({question.difficulty})
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Marks" htmlFor="add-marks">
                      <TextInput id="add-marks" name="maximum_score" type="number" min={1} max={1000} defaultValue={10} required />
                    </Field>
                  </div>
                </ActionForm>
              )}
            </Panel>
            <Panel className="p-5">
              <h3 className="mb-2 text-sm font-semibold text-ink">Publish</h3>
              <p className="mb-4 text-[13px] text-ink-muted">A published exam cannot change. Check the questions and marks first.</p>
              {items.length > 0 ? (
                <ActionForm action={publishExam} submitLabel="Publish exam">
                  <input type="hidden" name="exam_id" value={examId} />
                  <input type="hidden" name="version_id" value={version.id} />
                </ActionForm>
              ) : (
                <p className="text-[13px] text-ink-muted">Add at least one question.</p>
              )}
            </Panel>
            <Panel className="p-5 md:col-span-2">
              <h3 className="mb-2 text-sm font-semibold text-ink">Add a question pool</h3>
              <p className="mb-4 text-[13px] text-ink-muted">
                Each student gets a different random set of the pool&apos;s questions, the same set every time they open the exam. Give the pool&apos;s questions the same marks.
              </p>
              <ActionForm action={addPool} submitLabel="Add pool">
                <input type="hidden" name="exam_id" value={examId} />
                <input type="hidden" name="version_id" value={version.id} />
                <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                  <Field label="Title" htmlFor="pool-title">
                    <TextInput id="pool-title" name="title" defaultValue="Pool" maxLength={300} required />
                  </Field>
                  <Field label="Questions each" htmlFor="pool-draw">
                    <TextInput id="pool-draw" name="draw_count" type="number" min={1} max={100} defaultValue={1} required />
                  </Field>
                </div>
              </ActionForm>
            </Panel>
          </div>
        )}
      </Section>

      {!draft && (
        <Section title="Assigned to" description="Students in a target see the exam on their dashboard. New students who join later get it too.">
          {content.assignment_rules.length > 0 && (
            <div className="mb-4">
              <Table head={["Target", "Window", "Students", "Close at"]}>
                {content.assignment_rules.map((rule) => (
                  <tr key={rule.id}>
                    <td className="px-4 py-2.5 text-ink">
                      {TARGET_LABEL[rule.target_type]}: {targetName.get(rule.target_id) ?? rule.target_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">{formatWindow(rule.available_from, rule.available_until)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-ink">{rule.assigned_candidates}</td>
                    <td className="px-4 py-2.5">
                      <MoveWindow examId={examId} ruleId={rule.id} closes={isoToCollegeTime(rule.available_until)} />
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
          <Panel className="p-5">
            <AssignForm
              examId={examId}
              versionId={version.id}
              opens={isoToCollegeTime(version.opens_at)}
              closes={isoToCollegeTime(version.closes_at)}
              targets={{
                batch: batches.map((batch) => ({ id: batch.id, label: `${batch.name} (${batch.academic_year})` })),
                department: departments.filter((department) => department.department_type === "college").map((department) => ({ id: department.id, label: departmentLabel(department) })),
                placement_department: placement.organizations.flatMap((organization) =>
                  organization.departments.map((department) => ({ id: department.id, label: `${departmentLabel(department)}, ${organization.legal_name}` })),
                ),
              }}
            />
          </Panel>
        </Section>
      )}

      {regradable.length > 0 && (
        <Section
          title="Regrade with a corrected question"
          description="A newer version of these questions was published, for example with fixed tests. Using it re-runs every student's answers to that question on the new tests; marks stay the same."
        >
          <div className="space-y-3">
            {regradable.map(({ item, pinned, newer }) => (
              <Panel key={item.id} className="p-4">
                <ActionForm action={regradeItem} submitLabel="Use it and regrade">
                  <input type="hidden" name="exam_id" value={examId} />
                  <input type="hidden" name="version_id" value={version.id} />
                  <input type="hidden" name="item_id" value={item.id} />
                  <Field label={`${item.position}. ${item.question_title ?? pinned.title} (now version ${pinned.version_number})`} htmlFor={`regrade-${item.id}`}>
                    <Select id={`regrade-${item.id}`} name="question_version_id">
                      {newer
                        .toSorted((a, b) => b.version_number - a.version_number)
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            Version {candidate.version_number}, {candidate.sample_test_case_count} sample and {candidate.hidden_test_case_count} hidden tests
                          </option>
                        ))}
                    </Select>
                  </Field>
                </ActionForm>
              </Panel>
            ))}
          </div>
        </Section>
      )}

      {!draft && (
        <Section
          title="Try as a student"
          description="Sit this exam yourself in a private copy, open for its duration plus ten minutes. Its answers and marks never reach this exam's results or the college statistics."
        >
          <Panel className="p-5">
            <ActionForm action={tryExam} submitLabel="Try this exam">
              <input type="hidden" name="version_id" value={version.id} />
            </ActionForm>
          </Panel>
        </Section>
      )}

      <Section title="Duplicate" description="A new draft with these questions, marks, instructions and duration, for another sitting. Assignments and lab lock are not copied.">
        <Panel className="p-5">
          <ActionForm action={duplicateExam} submitLabel="Duplicate exam">
            <input type="hidden" name="version_id" value={version.id} />
            <Field label="Title" htmlFor="copy-title">
              <TextInput id="copy-title" name="title" defaultValue={`${version.title} (copy)`} maxLength={300} required />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Opens" htmlFor="copy-opens">
                <TextInput id="copy-opens" name="opens_at" type="datetime-local" defaultValue={isoToCollegeTime(version.opens_at)} required />
              </Field>
              <Field label="Closes" htmlFor="copy-closes">
                <TextInput id="copy-closes" name="closes_at" type="datetime-local" defaultValue={isoToCollegeTime(version.closes_at)} required />
              </Field>
            </div>
          </ActionForm>
        </Panel>
      </Section>

      <Section title="Lab lockdown" description="Limit the exam to the lab's Safe Exam Browser, its network, or both. Checked on every request while the exam is open.">
        <Panel className="p-5">
          <ActionForm action={saveSebPolicy} submitLabel="Save lockdown">
            <input type="hidden" name="exam_id" value={examId} />
            <input type="hidden" name="title" value={version.title} />
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="enabled" defaultChecked={seb?.enabled ?? false} className="accent-[var(--brand)]" />
              Require Safe Exam Browser
            </label>
            <Field label="Browser Exam Keys or Config Keys" htmlFor="seb-keys" hint="From Safe Exam Browser on a lab machine. One per line.">
              <TextArea id="seb-keys" name="accepted_keys" defaultValue={(seb?.accepted_keys ?? []).join("\n")} className="font-mono text-xs" spellCheck={false} />
            </Field>
            <Field label="Lab networks" htmlFor="seb-networks" hint="The lab's public address or range (what a lab machine sees at whatismyip), one per line. Leave empty to allow any network.">
              <TextArea id="seb-networks" name="allowed_networks" defaultValue={(seb?.allowed_networks ?? []).join("\n")} className="font-mono text-xs" spellCheck={false} />
            </Field>
          </ActionForm>
          {seb?.enabled && (
            <Button asChild variant="secondary" size="sm" className="mt-4">
              <a href={`/api/seb/v1/tenants/${staff.tenantId}/exams/${examId}/seb-policy/launch-file`} download>
                <Download />
                Download launch file
              </a>
            </Button>
          )}
        </Panel>
      </Section>
    </>
  );
}
