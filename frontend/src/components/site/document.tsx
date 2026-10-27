import type { ReactNode } from "react";

export type DocSection = { id: string; title: string; body: ReactNode };

/** A long-form page (policy, terms, security): title, date, contents, sections. */
export function DocumentPage({ title, intro, updated, sections }: { title: string; intro: ReactNode; updated?: string; sections: DocSection[] }) {
  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-14 sm:pt-20">
      <header className="max-w-[46rem]">
        <h1 className="display text-[2.6rem] text-ink sm:text-[3.4rem]">{title}</h1>
        <div className="mt-5 text-[16px] leading-[1.7] text-ink-muted">{intro}</div>
        {updated && <p className="mt-4 text-[13px] text-ink-subtle">Last updated {updated}</p>}
      </header>
      <div className="mt-14 grid gap-12 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden lg:block">
          <ol className="sticky top-24 space-y-2 border-l border-line text-[13.5px]">
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="-ml-px block border-l border-transparent pl-4 text-ink-muted transition-colors hover:border-ink hover:text-ink">
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="max-w-[46rem] space-y-14">
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-24">
              <h2 className="font-serif text-[1.65rem] leading-tight text-ink">{section.title}</h2>
              <div className="prose-doc mt-4">{section.body}</div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
