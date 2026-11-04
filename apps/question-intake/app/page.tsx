import { FolderSimple } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Shell } from "@/components/shell";
import { TopicForm } from "@/components/topic-form";
import { Panel } from "@/components/ui";
import { type Topic, listTopics } from "@/lib/data";
import { requireViewer } from "@/lib/session";

function Counts({ topic }: { topic: Topic }) {
  return (
    <span className="flex gap-2 font-mono text-[12px]">
      <span className="rounded-full bg-success-soft px-2 py-0.5 text-success">{topic.easy} easy</span>
      <span className="rounded-full bg-warning-soft px-2 py-0.5 text-warning">{topic.medium} medium</span>
      <span className="rounded-full bg-danger-soft px-2 py-0.5 text-danger">{topic.hard} hard</span>
    </span>
  );
}

export default async function Home() {
  const { viewer } = await requireViewer();
  const topics = await listTopics();
  const top = topics.filter((topic) => !topic.parent_id);
  const questions = topics.reduce((sum, topic) => sum + topic.total, 0);
  return (
    <Shell viewer={viewer}>
      <div className="mb-5">
        <h1 className="text-[26px] font-semibold tracking-tight">Topics</h1>
        <p className="mt-1 text-[14px] text-ink-muted">
          Create a topic first, then add questions to it by difficulty, exactly as the platform files them. {questions} question{questions === 1 ? "" : "s"} so far.{" "}
          <a href="/walkthrough.mp4" target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">Watch the 3 minute walkthrough</a>.
        </p>
      </div>
      <Panel className="mb-6">
        <TopicForm parents={top.map((topic) => ({ id: topic.id, name: topic.name }))} />
      </Panel>
      {top.length === 0 ? (
        <Panel className="py-12 text-center text-[14px] text-ink-muted">No topics yet. Create the first one above.</Panel>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {top.map((topic) => {
            const children = topics.filter((entry) => entry.parent_id === topic.id);
            return (
              <div key={topic.id} className="rounded-[var(--radius-surface)] border border-line bg-surface p-5 shadow-[var(--shadow-hairline)] transition-shadow hover:shadow-[var(--shadow-panel)]">
                <Link href={`/topics/${topic.id}`} className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-full bg-brand-soft text-brand">
                    <FolderSimple className="size-5" weight="duotone" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-semibold">{topic.name}</span>
                    <span className="block text-[12.5px] text-ink-muted">{topic.total} question{topic.total === 1 ? "" : "s"}</span>
                  </span>
                </Link>
                <div className="mt-3">
                  <Counts topic={topic} />
                </div>
                {children.length > 0 && (
                  <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
                    {children.map((child) => (
                      <li key={child.id} className="flex items-center justify-between gap-2 text-[13.5px]">
                        <Link href={`/topics/${child.id}`} className="truncate hover:text-brand">↳ {child.name}</Link>
                        <span className="font-mono text-[12px] text-ink-muted">{child.total}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
