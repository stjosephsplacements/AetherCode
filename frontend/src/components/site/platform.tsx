import { Fragment } from "react";
import { SITE } from "@/lib/site";
import { DIAGRAMS } from "./platform-diagrams";

const PARTS = [
  { label: "judging", title: "Run it. Judge it.", diagram: DIAGRAMS.judge, body: "Code runs in a sandbox with no network and hard CPU, memory and time limits." },
  { label: "services", title: "Built as services", diagram: DIAGRAMS.services, body: "A gateway in front of separate services for accounts, exams, submissions and the judge." },
  { label: "open source", title: "Read every line", diagram: DIAGRAMS.oss, body: `Licensed under the ${SITE.license}. Audit how marks are decided and run it on your own servers.` },
  { label: "security", title: "Secure by default", diagram: DIAGRAMS.shield, body: "Row-level security keeps colleges apart, and services talk to each other over mutual TLS." },
];

/** One bordered window split into four columns, each a part of the platform with its diagram drawn in text. */
export function Platform() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <h2 className="heading text-center text-[2.4rem] text-ink sm:text-[3.4rem]">Powered by the AetherCode platform</h2>
      <div data-reveal className="mt-12 border border-ink bg-surface shadow-[6px_6px_0_var(--ink)]">
        <div className="flex items-center justify-between border-b border-ink px-5 py-2.5 font-mono text-[13px] text-ink-muted">
          <span>[ platform ]</span>
          <span>{PARTS.length} parts</span>
        </div>
        <div className="grid gap-px bg-ink sm:grid-cols-2 lg:grid-cols-4">
          {PARTS.map((part) => (
            <article key={part.label} className="flex flex-col bg-surface p-6">
              <p className="font-mono text-[12.5px] text-ink-subtle">[ {part.label} ]</p>
              <h3 className="heading mt-3 text-[1.7rem] leading-[1.15] text-ink">{part.title}</h3>
              <div aria-hidden className="flex flex-1 items-center justify-center py-8">
                <pre className="font-mono text-[12px] leading-[1.4] text-ink">
                  {part.diagram.map((line, index) => (
                    <Fragment key={index}>
                      {line.includes("[ok]") ? (
                        <>
                          {line.split("[ok]")[0]}
                          <span className="text-success">[ok]</span>
                          {line.split("[ok]")[1]}
                        </>
                      ) : (
                        line
                      )}
                      {"\n"}
                    </Fragment>
                  ))}
                </pre>
              </div>
              <p className="text-[14.5px] leading-relaxed text-ink-muted">{part.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
