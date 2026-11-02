import type { ReactNode } from "react";

export type DocSection = { id: string; title: string; body: ReactNode };

/** A long-form page (policy, terms, security): title, date, contents, sections. */
export function DocumentPage({ title, intro, updated, sections }: { title: string; intro: ReactNode; updated?: string; sections: DocSection[] }) {
  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-14 sm:pt-20">
      <header className="max-w-[46rem]">
        <h1 className="display text-[2.6rem] text-ink sm:text-[3.4rem]">{title}</h1>
        <div className="mt-5 text-[16px] leading-[1.7] text-ink-muted">{intro}</div>
        {updated && <p className="mt-4 font-mono text-[12.5px] text-ink-subtle">{"// last updated "}{updated}</p>}
      </header>
      <div className="mt-14 grid gap-12 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden lg:block">
          <div className="sticky top-24 border border-ink bg-surface font-mono text-[12.5px] shadow-[4px_4px_0_var(--ink)]">
            <p className="border-b border-ink px-4 py-2 text-ink-subtle">[ contents ]</p>
            <ol className="py-1">
              {sections.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`} className="flex gap-2 px-4 py-1.5 text-ink-muted transition-colors hover:bg-brand hover:text-brand-ink">
                    <span aria-hidden className="text-ink-subtle">{String(index + 1).padStart(2, "0")}</span>
                    <span>{section.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>
        <div className="max-w-[46rem] space-y-14">
          {sections.map((section) => (
            <section key={section.id} id={section.id} data-reveal className="scroll-mt-24">
              <h2 className="heading text-[1.7rem] leading-tight text-ink">
                <span aria-hidden className="mr-2 font-mono text-[0.8em] text-brand">##</span>
                {section.title}
              </h2>
              <div className="prose-doc mt-4">{section.body}</div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
