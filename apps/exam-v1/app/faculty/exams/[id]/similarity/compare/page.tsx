import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { finalCode } from "@/lib/similarity-report";
import { LANGUAGES, isLanguageId } from "@/lib/languages";
import { AppShell } from "@/components/app-shell";
import { Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ a?: string; b?: string; slot?: string }>;
}) {
  const user = await requireUser("faculty", "admin");
  const { id } = await params;
  const { a, b, slot } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const programs = (await finalCode(id)).filter((row) => String(row.slot) === slot && (row.attempt_id === a || row.attempt_id === b));
  const left = programs.find((row) => row.attempt_id === a);
  const right = programs.find((row) => row.attempt_id === b);
  if (!left || !right) notFound();

  return (
    <AppShell user={user}>
      <Link href={`/faculty/exams/${id}/similarity`} className="mb-4 inline-block text-sm text-muted hover:text-ink">
        ← Similarity report
      </Link>
      <PageHeader eyebrow={`Q${Number(slot) + 1} · side by side`} title={`${left.username} vs ${right.username}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        {[left, right].map((program) => (
          <Card key={program.attempt_id} className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-line bg-sunken px-4 py-2 text-sm">
              <Link href={`/faculty/attempts/${program.attempt_id}`} className="font-semibold text-brand hover:underline">
                {program.username} · {program.name}
              </Link>
              <span className="text-xs text-muted">{isLanguageId(program.language) ? LANGUAGES[program.language].label : program.language}</span>
            </div>
            <pre className="max-h-[70vh] overflow-auto p-4 font-mono text-[13px] leading-relaxed">
              {program.source.split("\n").map((line, index) => (
                <div key={index} className="flex">
                  <span className="w-10 shrink-0 select-none pr-3 text-right text-faint">{index + 1}</span>
                  <span>{line}</span>
                </div>
              ))}
            </pre>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
