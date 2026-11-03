import { MagnifyingGlass, Plus } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Shell } from "@/components/shell";
import { Panel } from "@/components/ui";
import { sql } from "@/lib/db";
import { requireViewer } from "@/lib/session";

const TONE = { easy: "bg-success-soft text-success", medium: "bg-warning-soft text-warning", hard: "bg-danger-soft text-danger" } as const;

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string; difficulty?: string }> }) {
  const { viewer } = await requireViewer();
  const { q = "", difficulty = "" } = await searchParams;
  const rows = await sql`
    SELECT q.id, q.title, q.difficulty, q.topics, q.author_name, q.verified_at,
           (SELECT count(*)::int FROM question_tests t WHERE t.question_id = q.id) AS tests,
           (SELECT coalesce(array_agg(s.language ORDER BY s.language), '{}') FROM question_solutions s WHERE s.question_id = q.id) AS languages
    FROM questions q
    WHERE (${q} = '' OR q.title ILIKE ${"%" + q + "%"} OR ${q} = ANY (q.topics))
      AND (${difficulty} = '' OR q.difficulty = ${difficulty})
    ORDER BY q.updated_at DESC LIMIT 200`;
  const [{ total } = { total: 0 }] = await sql`SELECT count(*)::int AS total FROM questions`;
  return (
    <Shell viewer={viewer}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">Questions</h1>
          <p className="mt-1 text-[14px] text-ink-muted">{total} verified question{total === 1 ? "" : "s"} uploaded by staff. Each passed the judge before it was saved.</p>
        </div>
        <Link href="/questions/new" className="inline-flex h-9 items-center gap-2 rounded-full bg-brand px-4 text-[13.5px] font-medium text-brand-ink hover:bg-brand-hover">
          <Plus className="size-4" /> New question
        </Link>
      </div>
      <form className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <input name="q" defaultValue={q} placeholder="Search by title or topic" className="h-9 w-full rounded-full border border-line-strong bg-surface pl-9 pr-3 text-[14px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/15" />
        </div>
        <select name="difficulty" defaultValue={difficulty} className="h-9 rounded-full border border-line-strong bg-surface px-3 text-[14px]">
          <option value="">Any difficulty</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
        <button className="h-9 rounded-full border border-line-strong px-4 text-[13.5px] hover:bg-hover">Filter</button>
      </form>
      {rows.length === 0 ? (
        <Panel className="py-12 text-center text-[14px] text-ink-muted">No questions yet. Upload the first one.</Panel>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
          <table className="w-full text-left text-[14px]">
            <thead>
              <tr className="border-b border-line bg-sidebar font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">
                <th className="px-4 py-2.5 font-normal">Title</th>
                <th className="px-4 py-2.5 font-normal">Difficulty</th>
                <th className="hidden px-4 py-2.5 font-normal md:table-cell">Topics</th>
                <th className="hidden px-4 py-2.5 font-normal md:table-cell">Verified in</th>
                <th className="px-4 py-2.5 font-normal">Tests</th>
                <th className="hidden px-4 py-2.5 font-normal sm:table-cell">Author</th>
              </tr>
            </thead>
            <tbody className="[&_tr+tr]:border-t [&_tr+tr]:border-line [&_tr:hover]:bg-hover">
              {rows.map((row) => (
                <tr key={row.id as string}>
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/questions/${row.id}`} className="hover:text-brand">{row.title as string}</Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium capitalize ${TONE[row.difficulty as keyof typeof TONE]}`}>{row.difficulty as string}</span>
                  </td>
                  <td className="hidden px-4 py-3 text-ink-muted md:table-cell">{(row.topics as string[]).join(", ") || "-"}</td>
                  <td className="hidden px-4 py-3 font-mono text-[12.5px] text-ink-muted md:table-cell">{(row.languages as string[]).join(", ")}</td>
                  <td className="px-4 py-3 font-mono tabular-nums">{row.tests as number}</td>
                  <td className="hidden px-4 py-3 text-ink-muted sm:table-cell">{row.author_name as string}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
