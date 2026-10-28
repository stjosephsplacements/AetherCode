import { cn } from "@/lib/utils";

/** Four tinted cards, one per part of an exam day, each with a small sketch in the real screen's words. */
export function Meet() {
  return (
    <section id="product" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-24">
      <div className="text-center">
        <h2 className="heading text-[2.6rem] text-ink sm:text-[3.6rem]">
          Meet <span className="marker">AetherCode</span>
        </h2>
        <p data-reveal className="mt-2 text-[18px] text-ink-subtle">
          Everything between the question and the result
        </p>
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-2">
        <Card tone="bg-[#f7b49a] text-[#2b140a]" label="Exam lockdown" title="Locked when it counts" body="Staff choose what each exam needs. Every request is checked against it.">
          <ul className="space-y-1 text-[1.5rem] font-medium tracking-[-0.02em]">
            {["Safe Exam Browser", "Lab networks", "Fullscreen"].map((item, index) => (
              <li key={item} className={cn("rounded-l-[10px] px-4 py-2", index === 0 ? "bg-[#c84a0c] text-white" : "text-[#2b140a]/80")}>
                {item}
              </li>
            ))}
          </ul>
        </Card>

        <Card tone="bg-[#141210] text-[#f2efe9] ring-1 ring-white/10" label="The exam screen" title="Code like it's your IDE" body="Six languages, Run code on the samples or your own input, and your work saves as you type.">
          <div className="rounded-l-[12px] bg-[#1f1c19] p-4 font-mono text-[12.5px] leading-6">
            <p>
              <span className="text-[#ff8a4c]">def</span> <span className="text-[#c9c1ff]">solve</span>(nums):
            </p>
            <p>
              {"    "}
              <span className="text-[#ff8a4c]">return</span> sorted(<span className="text-[#c9c1ff]">set</span>(nums))[-2]
            </p>
            <p className="mt-3 text-[13px] text-[#4ade80]">\o/ 2 of 2 sample tests passed</p>
          </div>
        </Card>

        <Card tone="bg-surface-2 text-ink" label="Live monitor" title="Watch it happen" body="Every student's status and time left. Add time for one, or announce to all.">
          <ul className="divide-y divide-line rounded-l-[12px] bg-surface font-mono text-[12.5px]">
            {[
              ["21CS042", "In progress", "18:04"],
              ["21CS051", "Handed in", "-"],
              ["21CS063", "Not started", "60:00"],
            ].map(([roll, status, left]) => (
              <li key={roll} className="flex items-center gap-3 px-4 py-2.5">
                <span>{roll}</span>
                <span className="text-ink-muted">{status}</span>
                <span className="ml-auto">{left}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card tone="bg-[linear-gradient(135deg,#c84a0c,#a63a06)] text-white" label="Results" title="Marks you can explain" body="Hidden until faculty release them. Then every test's verdict, never the hidden inputs.">
          <div className="flex flex-col items-start gap-2">
            {[
              ["Test 1 passed", true],
              ["Test 2 passed", true],
              ["Test 3 time limit exceeded", false],
            ].map(([label, ok]) => (
              <span key={String(label)} className="inline-flex items-center gap-2 rounded-l-[8px] bg-white/90 px-3 py-1.5 font-mono text-[12.5px] text-[#2b140a]">
                <span className={ok ? "text-[#0f7a4d]" : "text-[#c42b4a]"}>{ok ? "[ok]" : "[x_x]"}</span>
                {label}
              </span>
            ))}
          </div>
        </Card>
      </div>
    </section>
  );
}

function Card({ tone, label, title, body, children }: { tone: string; label: string; title: string; body: string; children: React.ReactNode }) {
  return (
    <article data-reveal className={cn("grid min-h-[300px] items-center gap-6 overflow-hidden rounded-[20px] py-8 pl-8 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]", tone)}>
      <div className="pr-8 sm:pr-0">
        <p className="text-[12.5px] opacity-75">[ {label.toLowerCase()} ]</p>
        <h3 className="mt-3 text-[1.9rem] font-medium leading-[1.1] tracking-[-0.03em]">{title}</h3>
        <p className="mt-3 text-[14px] leading-relaxed opacity-80">{body}</p>
      </div>
      <div aria-hidden>{children}</div>
    </article>
  );
}
