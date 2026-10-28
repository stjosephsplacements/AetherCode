import { SITE } from "@/lib/site";

/** Four tall cards, warming from paper to orange, each with a text-drawn diagram of how that part works. */
export function Platform() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <h2 className="heading text-center text-[2.4rem] text-ink sm:text-[3.2rem]">Powered by the AetherCode platform</h2>
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tall tone="bg-surface text-ink ring-1 ring-line" label="Judging" title="Run it. Judge it." body="Code runs in a sandbox with no network and hard CPU, memory and time limits.">
          <pre className="mx-auto w-fit font-mono text-[12px] leading-[1.35]">{`  +----------+
  | Run code |
  +----------+
       |
       v
  +----------+
  |  Judge   |  no network
  | sandbox  |  CPU, memory,
  +----------+  time limits
       |
       v
  +----------+
  | Verdict  |
  +----------+`}</pre>
        </Tall>
        <Tall tone="bg-[#ddd5cd] text-[#231c16]" label="Services" title="Built as services" body="A gateway in front of separate services for accounts, exams, submissions and the judge.">
          <pre className="mx-auto w-fit font-mono text-[12px] leading-[1.35]">{`+--------------+
|   Gateway    |
+------+-------+
       |
+------+-------+
|   Identity   |
+--------------+
|  Submission  |
+--------------+
|    Judge     |
+--------------+`}</pre>
        </Tall>
        <Tall tone="bg-[#fbb79c] text-[#2b140a]" label="Open source" title="Read every line" body={`Licensed under the ${SITE.license}. Audit how marks are decided and run it on your own servers.`}>
          <pre className="mx-auto w-fit font-mono text-[12px] leading-[1.35]">{`$ git clone \\
    github.com/AlgoQX/
    AetherCode

  LICENSE   AGPL v3
  source    every line
  hosting   your servers`}</pre>
        </Tall>
        <Tall tone="bg-[#c84a0c] text-white" label="Security" title="Secure by default" body="Row-level security keeps colleges apart, and services talk to each other over mutual TLS.">
          <pre className="mx-auto w-fit font-mono text-[12px] leading-[1.35]">{`  .--------.  
 /   RLS    \\ 
|    mTLS    |
|  sandbox   |
 \\   [ok]   / 
  '--------'  `}</pre>
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
