import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, PageHeader, buttonClass, inputClass } from "@/components/ui";
import { Pagination } from "@/components/pagination";
import { ImportQuestions } from "./import-questions";

const PAGE_SIZE = 25;
const DIFFICULTY_TONE = { easy: "pass", medium: "accent", hard: "error" } as const;

export default async function QuestionsPage({ searchParams }: { searchParams: Promise<{ page?: string; topic?: string; difficulty?: string; q?: string }> }) {
  const user = await requireUser("faculty", "admin");
  const { page: pageStr = "1", topic = "", difficulty = "", q = "" } = await searchParams;
  const page = Math.max(1, Number(pageStr) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const topics = await sql<{ topic: string; count: number }[]>`
    SELECT topic, count(*)::int AS count FROM questions WHERE topic IS NOT NULL GROUP BY topic ORDER BY topic`;

  const hasTopic = topic !== "";
  const hasDifficulty = difficulty !== "" && ["easy", "medium", "hard"].includes(difficulty);
  const hasSearch = q.trim() !== "";
  const pattern = `%${q.trim().toLowerCase()}%`;

  const [{ total }] = await sql<{ total: number }[]>`
    SELECT count(*)::int AS total FROM questions
    WHERE (${!hasTopic} OR topic = ${topic})
      AND (${!hasDifficulty} OR difficulty = ${difficulty})
      AND (${!hasSearch} OR lower(title) LIKE ${pattern})`;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const questions = await sql<
    { id: string; title: string; kind: string; topic: string | null; difficulty: string | null; options: number | null; samples: number; hidden: number; updated_at: Date; author: string | null }[]
  >`
    SELECT q.id, q.title, q.kind, q.topic, q.difficulty, array_length(q.mcq_options, 1) AS options, q.updated_at, u.name AS author,
      count(t.*) FILTER (WHERE t.is_sample)::int AS samples,
      count(t.*) FILTER (WHERE NOT t.is_sample)::int AS hidden
    FROM questions q
    LEFT JOIN test_cases t ON t.question_id = q.id
    LEFT JOIN users u ON u.id = q.created_by
    WHERE (${!hasTopic} OR q.topic = ${topic})
      AND (${!hasDifficulty} OR q.difficulty = ${difficulty})
      AND (${!hasSearch} OR lower(q.title) LIKE ${pattern})
    GROUP BY q.id, u.name
    ORDER BY q.topic NULLS LAST, CASE q.difficulty WHEN 'easy' THEN 0 WHEN 'medium' THEN 1 WHEN 'hard' THEN 2 ELSE 3 END, q.updated_at DESC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}`;

  function buildHref(p: number) {
    const params = new URLSearchParams();
    if (p > 1) params.set("page", String(p));
    if (topic) params.set("topic", topic);
    if (difficulty) params.set("difficulty", difficulty);
    if (q) params.set("q", q);
    const qs = params.toString();
    return `/faculty/questions${qs ? `?${qs}` : ""}`;
  }

  const grouped = !hasTopic && !hasDifficulty && !hasSearch;
  const groups = grouped ? groupByTopic(questions) : null;

  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="Question bank"
        title="Questions"
        actions={
          <>
            <ImportQuestions />
            {total > 0 && (
              <a href="/faculty/questions/export" className={buttonClass("secondary")}>
                Export all
              </a>
            )}
            <Link href="/faculty/questions/new" className={buttonClass()}>
              New question
            </Link>
          </>
        }
      />

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Link href="/faculty/questions" className={buttonClass(!hasTopic && !hasDifficulty ? "primary" : "secondary", "sm")}>All</Link>
        {topics.map((t) => (
          <Link key={t.topic} href={`/faculty/questions?topic=${encodeURIComponent(t.topic)}`} className={buttonClass(topic === t.topic ? "primary" : "secondary", "sm")}>
            {t.topic} · {t.count}
          </Link>
        ))}
        <span className="mx-1 text-line-strong">|</span>
        {(["easy", "medium", "hard"] as const).map((d) => (
          <Link key={d} href={`/faculty/questions?difficulty=${d}${topic ? `&topic=${encodeURIComponent(topic)}` : ""}`} className={buttonClass(difficulty === d ? "primary" : "ghost", "sm")}>
            {d.charAt(0).toUpperCase() + d.slice(1)}
          </Link>
        ))}
      </div>

      <form className="mb-4">
        {topic && <input type="hidden" name="topic" value={topic} />}
        {difficulty && <input type="hidden" name="difficulty" value={difficulty} />}
        <input name="q" defaultValue={q} placeholder="Search questions by title…" className={`${inputClass} max-w-md`} />
      </form>

      {groups ? (
        // Grouped view: topic headings with questions underneath
        groups.map(([topicName, items]) => (
          <div key={topicName} className="mb-6">
            <h3 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
              {topicName}
              <span className="text-sm font-normal text-muted">({items.length})</span>
            </h3>
            <Card className="divide-y divide-line">
              {items.map((question) => <QuestionRow key={question.id} question={question} />)}
            </Card>
          </div>
        ))
      ) : (
        // Flat filtered view
        <Card className="divide-y divide-line">
          {questions.map((question) => <QuestionRow key={question.id} question={question} />)}
          {questions.length === 0 && <p className="px-5 py-12 text-center text-sm text-muted">No questions match your filters.</p>}
        </Card>
      )}

      <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />
    </AppShell>
  );
}

type QuestionRow = { id: string; title: string; kind: string; topic: string | null; difficulty: string | null; options: number | null; samples: number; hidden: number; updated_at: Date; author: string | null };

function QuestionRow({ question }: { question: QuestionRow }) {
  return (
    <Link href={`/faculty/questions/${question.id}`} className="flex flex-wrap items-center gap-3 px-5 py-4 hover:bg-sunken/60">
      <span className="mr-auto font-semibold">{question.title}</span>
      {question.difficulty && (
        <Badge tone={DIFFICULTY_TONE[question.difficulty as keyof typeof DIFFICULTY_TONE] ?? "neutral"}>
          {question.difficulty.charAt(0).toUpperCase() + question.difficulty.slice(1)}
        </Badge>
      )}
      {question.kind === "mcq" ? (
        <Badge tone="accent">MCQ · {question.options} options</Badge>
      ) : (
        <>
          <Badge tone="brand">{question.samples} sample</Badge>
          <Badge>{question.hidden} hidden</Badge>
        </>
      )}
      <span className="w-40 text-right text-xs text-faint">
        {question.author ?? "—"} · {question.updated_at.toLocaleDateString("en-IN")}
      </span>
    </Link>
  );
}

function groupByTopic(questions: QuestionRow[]): [string, QuestionRow[]][] {
  const map = new Map<string, QuestionRow[]>();
  for (const q of questions) {
    const key = q.topic ?? "Uncategorized";
    const list = map.get(key);
    if (list) list.push(q);
    else map.set(key, [q]);
  }
  const entries = [...map.entries()];
  const uncategorized = entries.findIndex(([k]) => k === "Uncategorized");
  if (uncategorized > -1) entries.push(entries.splice(uncategorized, 1)[0]);
  return entries;
}
