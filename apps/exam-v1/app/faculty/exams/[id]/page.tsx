import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import type { LanguageId } from "@/lib/languages";
import { AppShell } from "@/components/app-shell";
import { PageHeader, buttonClass } from "@/components/ui";
import { ExamForm } from "../exam-form";
import { cloneExam, previewExam } from "../../actions";
import { formOptions } from "../load";
import { clientIp } from "@/lib/client-ip";

export default async function EditExamPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const user = await requireUser("faculty", "admin");
  const { id } = await params;
  const { saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [exam] = await sql<
    Array<{
      title: string;
      instructions: string;
      starts_at: Date;
      ends_at: Date;
      duration_minutes: number;
      languages: LanguageId[];
      batches: string[];
      published: boolean;
      allowed_networks: string[];
      require_fullscreen: boolean;
      block_external_paste: boolean;
    }>
  >`SELECT title, instructions, starts_at, ends_at, duration_minutes, languages, batches, published,
      allowed_networks, require_fullscreen, block_external_paste
    FROM exams WHERE id = ${id}`;
  if (!exam) notFound();
  const questions = await sql<{ question_id: string; points: number; slot: number }[]>`
    SELECT question_id, points, slot FROM exam_questions WHERE exam_id = ${id} ORDER BY ord`;
  const [{ started }] = await sql<{ started: boolean }[]>`SELECT exists(SELECT 1 FROM attempts WHERE exam_id = ${id} AND NOT is_preview) AS started`;
  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="Assessments"
        title={exam.title}
        actions={
          <>
            <form action={cloneExam.bind(null, id)}>
              <button className={buttonClass("ghost")}>Duplicate</button>
            </form>
            <form action={previewExam.bind(null, id)}>
              <button className={buttonClass("secondary")}>Preview as student</button>
            </form>
            <Link href={`/faculty/exams/${id}/results`} className={buttonClass("secondary")}>
              Results
            </Link>
          </>
        }
      />
      {saved && <p className="mb-6 rounded-xl bg-pass-soft px-4 py-3 text-sm font-medium text-pass">Saved.</p>}
      <ExamForm
        id={id}
        locked={started}
        viewerIp={await clientIp()}
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
          allowedNetworks: exam.allowed_networks,
          requireFullscreen: exam.require_fullscreen,
          blockExternalPaste: exam.block_external_paste,
          questions: questions.map((question) => ({ questionId: question.question_id, points: question.points, slot: question.slot })),
        }}
      />
    </AppShell>
  );
}
