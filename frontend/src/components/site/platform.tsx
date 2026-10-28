import { GitBranch, ShieldCheck } from "lucide-react";
import { SITE } from "@/lib/site";

/** Four tall cards, warming from paper to orange, each with a line drawing of how that part works. */
export function Platform() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <h2 className="heading text-center text-[2.4rem] text-ink sm:text-[3.2rem]">Powered by the AetherCode platform</h2>
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tall tone="bg-surface text-ink ring-1 ring-line" label="Judging" title="Run it. Judge it." body="Code runs in a sandbox with no network and hard CPU, memory and time limits.">
          <div className="relative mx-auto size-40 rounded-full border border-dashed border-brand/60">
            <span className="absolute -left-3 top-3 rounded-[8px] border border-line-strong bg-surface px-2.5 py-1 text-[12px] text-ink">Run code</span>
            <span className="absolute -right-4 top-1/2 -translate-y-1/2 rounded-[8px] bg-brand px-2.5 py-1 text-[12px] text-brand-ink">Judge</span>
            <span className="absolute -bottom-2 left-2 rounded-[8px] border border-line-strong bg-surface px-2.5 py-1 text-[12px] text-ink">Verdict</span>
          </div>
        </Tall>
        <Tall tone="bg-[#ddd5cd] text-[#231c16]" label="Services" title="Built as services" body="A gateway in front of separate services for accounts, exams, submissions and the judge.">
          <ul className="mx-auto w-36 space-y-1.5 rounded-[14px] border-2 border-[#c84a0c] p-1.5 text-center text-[12.5px]">
            {["Gateway", "Identity", "Submission", "Judge"].map((name) => (
              <li key={name} className="rounded-[9px] border border-[#231c16]/40 py-1.5">
                {name}
              </li>
            ))}
          </ul>
        </Tall>
        <Tall tone="bg-[#fbb79c] text-[#2b140a]" label="Open source" title="Read every line" body={`Licensed under the ${SITE.license}. Audit how marks are decided and run it on your own servers.`}>
          <div className="mx-auto grid size-24 place-items-center rounded-[22px] bg-white/80">
            <GitBranch className="size-10 text-[#c84a0c]" strokeWidth={1.5} />
          </div>
        </Tall>
        <Tall tone="bg-[#c84a0c] text-white" label="Security" title="Secure by default" body="Row-level security keeps colleges apart, and services talk to each other over mutual TLS.">
          <ShieldCheck className="mx-auto size-24 opacity-90" strokeWidth={0.9} />
        </Tall>
      </div>
    </section>
  );
}

function Tall({ tone, label, title, body, children }: { tone: string; label: string; title: string; body: string; children: React.ReactNode }) {
  return (
    <article data-reveal className={`flex min-h-[460px] flex-col rounded-[20px] p-6 ${tone}`}>
      <p className="text-[13px] font-medium opacity-80">{label}</p>
      <h3 className="mt-2 text-[1.6rem] font-medium leading-[1.12] tracking-[-0.03em]">{title}</h3>
      <div aria-hidden className="flex flex-1 items-center py-8">
        <div className="w-full">{children}</div>
      </div>
      <p className="text-[14px] leading-relaxed opacity-85">{body}</p>
    </article>
  );
}
