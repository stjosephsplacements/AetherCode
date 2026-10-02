import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { LANGUAGES, isLanguageId } from "@/lib/languages";
import { similarityReport } from "@/lib/similarity-report";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, PageHeader, buttonClass } from "@/components/ui";

export const dynamic = "force-dynamic";

const label = (language: string) => (isLanguageId(language) ? LANGUAGES[language].label : language);

export default async function SimilarityPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("faculty", "admin");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [exam] = await sql<{ title: string }[]>`SELECT title FROM exams WHERE id = ${id}`;
  if (!exam) notFound();
  const report = await similarityReport(id);

  return (
    <AppShell user={user}>
      <Link href={`/faculty/exams/${id}/results`} className="mb-4 inline-block text-sm text-muted hover:text-ink">
        ← Results
      </Link>
      <PageHeader eyebrow="Similarity report" title={exam.title} />
      <p className="mb-8 max-w-3xl text-sm leading-relaxed text-muted">
        Pairs of students whose final code shares unusual structure, ignoring variable names, comments, formatting and code most of the class wrote.
        A high score is a reason to look, not proof: compare the code side by side and use your judgement.
      </p>
      {report.map((slot) => (
        <section key={slot.slot} className="mb-10">
          <div className="mb-3 flex flex-wrap items-baseline gap-3">
            <h2 className="font-display text-xl font-semibold tracking-tight">
              Q{slot.slot + 1}. {slot.title}
            </h2>
            <span className="text-sm text-muted">{slot.programs} programs compared</span>
          </div>
          {slot.pairs.length === 0 ? (
            <Card className="px-5 py-6 text-sm text-muted">No suspicious pairs.</Card>
          ) : (
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-sunken text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2.5">Similarity</th>
                    <th className="px-4 py-2.5">Student A</th>
                    <th className="px-4 py-2.5">Student B</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {slot.pairs.map((pair) => (
                    <tr key={`${pair.a.attemptId}-${pair.b.attemptId}`} className="border-t border-line">
                      <td className="px-4 py-2.5">
                        <Badge tone={pair.score >= 0.9 ? "error" : pair.score >= 0.75 ? "fail" : "accent"}>{Math.round(pair.score * 100)}%</Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-medium">{pair.a.username}</span> {pair.a.name} <span className="text-faint">· {label(pair.a.language)}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-medium">{pair.b.username}</span> {pair.b.name} <span className="text-faint">· {label(pair.b.language)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link href={`/faculty/exams/${id}/similarity/compare?a=${pair.a.attemptId}&b=${pair.b.attemptId}&slot=${slot.slot}`} className={buttonClass("secondary", "sm")}>
                          Compare
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </section>
      ))}
    </AppShell>
  );
}
