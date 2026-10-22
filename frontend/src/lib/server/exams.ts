import "server-only";
import type { Exam, ExamVersion, ExamVersionContent, Page } from "@/lib/api-types";
import { gateway } from "./gateway";

/** An exam with its newest version (title, window and status live on versions). */
export type ExamWithVersion = { exam: Exam; version: ExamVersion | null };

export async function latestVersion(tenantId: string, examId: string): Promise<ExamVersion | null> {
  const versions = (await gateway<Page<ExamVersion>>(`/assessment/v1/tenants/${tenantId}/exams/${examId}/versions?limit=100`)).items;
  return versions.reduce<ExamVersion | null>((newest, version) => (!newest || version.version_number > newest.version_number ? version : newest), null);
}

/**
 * Every exam of a college with its newest version. The list carries each
 * exam's latest version (ADR-0043), so this is one request per 100 exams,
 * not one per exam; the per-exam call remains for an older Assessment.
 */
export async function listExams(tenantId: string, { previews = false }: { previews?: boolean } = {}): Promise<ExamWithVersion[]> {
  const exams: (Exam & { latest_version?: ExamVersion })[] = [];
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const result = await gateway<Page<Exam & { latest_version?: ExamVersion }>>(
      `/assessment/v1/tenants/${tenantId}/exams?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    exams.push(...result.items);
    if (!result.next_cursor) break;
    cursor = result.next_cursor;
  }
  const listed = await mapLimit(exams, 6, async ({ latest_version, ...exam }) => ({
    exam,
    version: latest_version ?? (await latestVersion(tenantId, exam.id)),
  }));
  return previews ? listed : listed.filter(({ version }) => !version?.title.startsWith(PREVIEW_PREFIX));
}

/**
 * A preview is a private copy of an exam that one member of staff takes as a
 * student (ADR-0046). Copies carry this title prefix and stay out of the
 * lists, the calendar and the analytics.
 */
export const PREVIEW_PREFIX = "[Preview] ";

/**
 * A new draft exam with the source's instructions, duration, policy and
 * questions with their marks, under a new title and window. Assignments and
 * Safe Exam Browser settings are not copied.
 */
export async function copyExam(tenantId: string, sourceVersionId: string, title: string, opensAt: string, closesAt: string): Promise<{ exam: Exam; version: ExamVersion }> {
  const base = `/assessment/v1/tenants/${tenantId}`;
  const [source, content] = await Promise.all([
    gateway<ExamVersion>(`${base}/exam-versions/${sourceVersionId}`),
    gateway<ExamVersionContent>(`${base}/exam-versions/${sourceVersionId}/content`),
  ]);
  const exam = await gateway<Exam>(`${base}/exams`, { method: "POST", body: {} });
  const copy = await gateway<ExamVersion>(`${base}/exams/${exam.id}/versions`, {
    method: "POST",
    body: {
      expected_exam_version: exam.version,
      title,
      instructions_markdown: source.instructions_markdown,
      opens_at: opensAt,
      closes_at: closesAt,
      duration_seconds: source.duration_seconds,
      proctor_policy_version_id: source.proctor_policy_version_id,
    },
  });
  const copyBase = `${base}/exam-versions/${copy.id}`;
  // Every content change bumps the version's content_version.
  let contentVersion = copy.content_version;
  for (const section of [...content.sections].sort((a, b) => a.position - b.position)) {
    const created = await gateway<{ id: string }>(`${copyBase}/sections`, {
      method: "POST",
      body: {
        expected_content_version: contentVersion++,
        position: section.position,
        title: section.title,
        instructions_markdown: "",
        time_limit_seconds: null,
        draw_count: section.draw_count,
      },
    });
    for (const item of [...section.items].sort((a, b) => a.position - b.position)) {
      await gateway(`${copyBase}/sections/${created.id}/items`, {
        method: "POST",
        body: { expected_content_version: contentVersion++, position: item.position, question_version_id: item.question_version_id, maximum_score: item.maximum_score },
      });
    }
  }
  return { exam, version: copy };
}

/** Maps with at most `limit` calls in flight, to stay under the gateway's per-user rate limit. */
export async function mapLimit<T, R>(items: T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await map(items[index]!);
      }
    }),
  );
  return results;
}
