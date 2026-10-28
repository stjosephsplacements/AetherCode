import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/site";

const COMMANDS = [
  { text: "git clone https://github.com/AlgoQX/AetherCode" },
  { text: "cd AetherCode/deploy/single-server" },
  { text: "./setup.sh https://exam.your-college.edu" },
  { text: "docker compose build && docker compose up -d" },
  { text: "docker compose ps" },
];

/** The developer moment: always dark, the real one-server install beside the open-source pitch. */
export function OpenSource() {
  return (
    <section className="bg-[#050505] text-[#f2f2f2]">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 sm:py-28 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div>
          <h2 className="heading text-[2.3rem] sm:text-[3.1rem]">
            Open source. Run it on your own servers.
          </h2>
          <p className="mt-6 max-w-[30rem] text-[17px] leading-relaxed text-[#a3a3a3]">
            AetherCode is licensed under the {SITE.license}. Read how marks are decided, and deploy it on one server with the
            single-server guide.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Button asChild size="lg">
              <a href={SITE.repo}>
                View on GitHub
                <ArrowRight />
              </a>
            </Button>
            <a href="/architecture" className="group inline-flex items-center gap-1.5 text-[15px] font-medium">
              How it&apos;s built
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>
        </div>
        <div className="overflow-hidden rounded-[18px] border border-white/10 bg-[#0f0f0f] shadow-[0_40px_80px_-30px_rgb(0_0_0/0.7)]">
          <div className="flex items-center gap-1.5 border-b border-white/[0.08] px-4 py-3" aria-hidden>
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="ml-3 text-[12.5px] text-[#8a8a8a]">Deploy on one server</span>
          </div>
          <pre className="overflow-x-auto p-6 font-mono text-[13px] leading-7">
            {COMMANDS.map((line) => (
              <div key={line.text} className="text-[#f2f2f2]">
                <span className="select-none text-[#ff6a33]">$ </span>
                {line.text}
              </div>
            ))}
          </pre>
        </div>
      </div>
    </section>
  );
}
