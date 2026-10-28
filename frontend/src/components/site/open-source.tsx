import { SITE } from "@/lib/site";
import { Terminal } from "./terminal";

const COMMANDS = [
  { text: "git clone https://github.com/AlgoQX/AetherCode" },
  { text: "cd AetherCode/deploy/single-server" },
  { text: "./setup.sh https://exam.your-college.edu" },
  { text: "docker compose build && docker compose up -d" },
  { text: "docker compose ps" },
];

/** The developer moment: the real one-server install beside the open-source pitch. */
export function OpenSource() {
  return (
    <section className="text-ink">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 sm:py-28 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div>
          <h2 className="heading text-[2.3rem] sm:text-[3.1rem]">
            Open source. Run it on your own servers.
          </h2>
          <p data-reveal className="mt-6 max-w-[30rem] text-[17px] leading-relaxed text-ink-muted">
            AetherCode is licensed under the {SITE.license}. Read how marks are decided, and deploy it on one server with the
            single-server guide.
          </p>
          <div data-reveal className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
            <a
              href={SITE.repo}
              className="bg-brand px-4 py-2.5 font-mono text-[14px] text-brand-ink shadow-[3px_3px_0_var(--ink)] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5"
            >
              [ view on github -&gt; ]
            </a>
            <a href="/architecture" className="font-mono text-[14px] text-ink-muted transition-colors hover:text-brand">
              [ how it&apos;s built ]
            </a>
          </div>
        </div>
        <Terminal title="Deploy on one server" commands={COMMANDS.map((line) => line.text)} />
      </div>
    </section>
  );
}
