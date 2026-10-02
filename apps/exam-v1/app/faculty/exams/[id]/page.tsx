import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import type { LanguageId } from "@/lib/languages";
import { AppShell } from "@/components/app-shell";
import { PageHeader, buttonClass } from "@/components/ui";
import { ExamForm } from "../exam-form";
import { formOptions } from "../load";

export default async function EditExamPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const user = await requireUser("faculty", "admin");
  const { id } = await params;
  const { saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [exam] = await sql<
    Array<{ title: string; instructions: string; starts_at: Date; ends_at: Date; duration_minutes: number; languages: LanguageId[]; batches: string[]; published: boolean }>
  >`SELECT title, instructions, starts_at, ends_at, duration_minutes, languages, batches, published FROM exams WHERE id = ${id}`;
  if (!exam) notFound();
  const questions = await sql<{ question_id: string; points: number }[]>`
    SELECT question_id, points FROM exam_questions WHERE exam_id = ${id} ORDER BY ord`;
  const [{ started }] = await sql<{ started: boolean }[]>`SELECT exists(SELECT 1 FROM attempts WHERE exam_id = ${id}) AS started`;
  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="Assessments"
        title={exam.title}
        actions={
          <Link href={`/faculty/exams/${id}/results`} className={buttonClass("secondary")}>
            Results
          </Link>
        }
      />
      {saved && <p className="mb-6 rounded-xl bg-pass-soft px-4 py-3 text-sm font-medium text-pass">Saved.</p>}
      <ExamForm
        id={id}
        locked={started}
        {...(await formOptions())}
        initial={{
          title: exam.title,
          instructions: exam.instructions,
          startsAt: exam.starts_at.toISOString(),
          endsAt: exam.ends_at.toISOString(),
          durationMinutes: exam.duration_minutes,
          languages: exam.languages,
          batches: exam.batches,
          published: exam.published,
          questions: questions.map((question) => ({ questionId: question.question_id, points: question.points })),
        }}
      />
    </AppShell>
  );
}
