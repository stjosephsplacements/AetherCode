import { ArrowLeft, Plus } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { TopicForm } from "@/components/topic-form";
import { Panel } from "@/components/ui";
import { sql } from "@/lib/db";
import { getTopic, listTopics } from "@/lib/data";
import { cn } from "@/lib/cn";
import { DIFFICULTIES, type Difficulty } from "@/lib/platform";
import { requireViewer } from "@/lib/session";
import { deleteTopic } from "../actions";

export const metadata: Metadata = { title: "Topic" };

export default async function TopicPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ difficulty?: string }> }) {
  const { viewer } = await requireViewer();
  const { id } = await params;
  const { difficulty = "" } = await searchParams;
  const topic = await getTopic(id);
  if (!topic) notFound();
  const level: Difficulty = (DIFFICULTIES as readonly string[]).includes(difficulty) ? (difficulty as Difficulty) : "easy";
  const all = await listTopics();
  const parent = all.find((entry) => entry.id === topic.parent_id);
  const children = all.filter((entry) => entry.parent_id === topic.id);
  const rows = await sql`
    SELECT id, title, kind, tags, supported_languages, author_name, updated_at,
           (SELECT count(*)::int FROM question_tests t WHERE t.question_id = q.id) AS tests
    FROM questions q WHERE category_id = ${id} AND difficulty = ${level} ORDER BY updated_at DESC`;
  const admin = viewer.roles.some((role) => role === "super_admin" || role === "college_admin");
  return (
    <Shell viewer={viewer}>
      <Link href={parent ? `/topics/${parent.id}` : "/"} className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> {parent ? parent.name : "All topics"}
      </Link>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">{topic.name}</h1>
          <p className="mt-1 text-[14px] text-ink-muted">{topic.total} question{topic.total === 1 ? "" : "s"} in this topic.</p>
        </div>
        <Link href={`/questions/new?topic=${topic.id}&difficulty=${level}`} className="inline-flex h-9 items-center gap-2 rounded-full bg-brand px-4 text-[13.5px] font-medium text-brand-ink hover:bg-brand-hover">
          <Plus className="size-4" /> Add {level} question
        </Link>
      </div>

      <div role="tablist" aria-label="Difficulty" className="mb-4 inline-flex rounded-full border border-line bg-surface p-1">
        {DIFFICULTIES.map((entry) => (
          <Link key={entry} role="tab" aria-selected={entry === level} href={`/topics/${topic.id}?difficulty=${entry}`} className={cn("rounded-full px-4 py-1.5 text-[13.5px] capitalize transition-colors", entry === level ? "bg-brand-soft font-medium text-brand-soft-ink" : "text-ink-muted hover:text-ink")}>
            {entry} <span className="font-mono text-[12px] text-ink-subtle">{topic[entry]}</span>
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Panel className="py-12 text-center text-[14px] text-ink-muted">No {level} questions in {topic.name} yet.</Panel>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
          <table className="w-full text-left text-[14px]">
            <thead>
              <tr className="border-b border-line bg-sidebar font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">
                <th className="px-4 py-2.5 font-normal">Title</th>
                <th className="px-4 py-2.5 font-normal">Type</th>
                <th className="hidden px-4 py-2.5 font-normal md:table-cell">Tags</th>
                <th className="hidden px-4 py-2.5 font-normal md:table-cell">Languages</th>
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
                  <td className="px-4 py-3 text-ink-muted">{row.kind === "mcq" ? "Multiple choice" : "Coding"}</td>
                  <td className="hidden px-4 py-3 text-ink-muted md:table-cell">{(row.tags as string[]).join(", ") || "-"}</td>
                  <td className="hidden px-4 py-3 font-mono text-[12.5px] text-ink-muted md:table-cell">{(row.supported_languages as string[]).join(", ") || "-"}</td>
                  <td className="px-4 py-3 font-mono tabular-nums">{row.kind === "mcq" ? "-" : (row.tests as number)}</td>
                  <td className="hidden px-4 py-3 text-ink-muted sm:table-cell">{row.author_name as string}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!parent && (
        <Panel className="mt-8">
          <h2 className="mb-1 text-[15px] font-semibold">Sub-topics</h2>
          <p className="mb-3 text-[13px] text-ink-muted">Group questions further, for example Arrays then Two pointers.</p>
          {children.length > 0 && (
            <ul className="mb-3 flex flex-wrap gap-2">
              {children.map((child) => (
                <li key={child.id}>
                  <Link href={`/topics/${child.id}`} className="inline-flex items-center gap-2 rounded-full border border-line-strong px-3 py-1 text-[13px] hover:bg-hover">
                    {child.name} <span className="font-mono text-[12px] text-ink-muted">{child.total}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <TopicForm parents={[{ id: topic.id, name: topic.name }]} />
        </Panel>
      )}

      {topic.total === 0 && children.length === 0 && admin && (
        <form action={deleteTopic.bind(null, topic.id)} className="mt-6">
          <button className="text-[13px] text-danger hover:underline">Delete this empty topic</button>
        </form>
      )}
    </Shell>
  );
}
