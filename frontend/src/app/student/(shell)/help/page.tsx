import type { Metadata } from "next";
import { STUDENT_HELP } from "@/content/help";

export const metadata: Metadata = { title: "Help" };

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-[720px] animate-enter">
      <h1 className="display text-[2.25rem] text-ink">Help</h1>
      <p className="mt-2 text-[15px] text-ink-muted">Answers to what students ask most during exams. For anything else, ask your invigilator.</p>
      {STUDENT_HELP.map((section) => (
        <section key={section.title} className="mt-10">
          <h2 className="mb-3 text-sm font-medium text-ink-muted">{section.title}</h2>
          <div className="overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
            {section.entries.map((entry, index) => (
              <details key={entry.question} className={index > 0 ? "group border-t border-line" : "group"}>
                <summary className="cursor-pointer list-none px-5 py-3.5 text-[15px] font-medium text-ink transition-colors hover:bg-hover">{entry.question}</summary>
                <div className="px-5 pb-4 text-sm leading-relaxed text-ink-muted">{entry.answer}</div>
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
