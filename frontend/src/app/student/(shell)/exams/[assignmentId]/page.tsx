import { ArrowLeft, CalendarDots, Clock, Flask, FloppyDisk, Timer } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { listAssignments } from "@/lib/server/assignments";
import { requireViewer } from "@/lib/server/session";
import { formatDuration, formatWindow } from "@/lib/utils";
import { StartExam } from "./start-exam";

export const metadata: Metadata = { title: "Exam" };

const FACTS = [
  { icon: Timer, text: "Your timer starts when you press Start and keeps running if you close the page." },
  { icon: FloppyDisk, text: "Your code saves as you type. If your browser closes, sign in again to continue." },
  { icon: Flask, text: "Run checks your code on the sample tests. Hidden tests decide your marks." },
];

export default async function ExamLobby({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await params;
  const viewer = await requireViewer();
  const assignment = viewer.tenantId
    ? (await listAssignments(viewer.tenantId)).find((candidate) => candidate.id === assignmentId)
    : undefined;
  if (!assignment) notFound();

  return (
    <div className="mx-auto max-w-[680px] animate-enter">
      <Link href="/student" className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink">
        <ArrowLeft className="size-4" />
        My exams
      </Link>

      <h1 className="display mt-8 text-[2.1rem] text-ink sm:text-[2.4rem]">{assignment.title}</h1>
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[13px] text-ink-muted">
          <CalendarDots className="size-3.5" />
          {formatWindow(assignment.available_from, assignment.available_until)}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[13px] text-ink-muted">
          <Clock className="size-3.5" />
          {formatDuration(assignment.duration_seconds)}
        </span>
      </div>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Instructions</h2>
        <Markdown>{assignment.instructions_markdown}</Markdown>
      </section>

      <section aria-label="Before you start" className="mt-10 rounded-[var(--radius-surface)] bg-sidebar p-5 sm:p-6">
        <ul className="space-y-3.5">
          {FACTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex gap-3 text-sm leading-relaxed text-ink">
              <Icon className="mt-0.5 size-4 shrink-0 text-brand" />
              {text}
            </li>
          ))}
        </ul>
      </section>

      <StartExam assignment={assignment} signature={viewer.username} />
    </div>
  );
}
