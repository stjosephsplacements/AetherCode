import { Check, LockKeyhole, WifiOff } from "lucide-react";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

/** What the platform does, one row each: a small sketch of the screen beside a plain sentence. */
export function Features() {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-32">
      <h2 className="display max-w-[16ch] text-[2.6rem] text-ink sm:text-[3.6rem]">Built for the room where it actually happens.</h2>
      <div className="mt-20 space-y-24 sm:space-y-32">
        {ROWS.map((row, index) => (
          <div key={row.title} className="grid items-center gap-10 md:grid-cols-2 md:gap-20">
            <div className={index % 2 ? "md:order-2" : undefined}>
              <div aria-hidden className="grid aspect-[4/3] place-items-center overflow-hidden rounded-[24px] bg-surface-2 p-8">
                {row.visual}
              </div>
            </div>
            <div>
              <h3 className="font-serif text-[2.1rem] leading-[1.1] tracking-tight text-ink sm:text-[2.6rem]">{row.title}</h3>
              <p className="mt-4 max-w-[30rem] text-[16px] leading-relaxed text-ink-muted">{row.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const chip = "rounded-full bg-surface px-5 py-2.5 text-[15px] text-ink shadow-[var(--shadow-panel)]";

const ROWS = [
  {
    title: "Wi-Fi drops. Your code doesn't.",
    body: "Every keystroke is saved on your laptop first and synced when the connection comes back. Close the tab by accident and your answer is still there.",
    visual: (
      <div className="w-full max-w-[300px] space-y-3">
        <div className={`${chip} flex items-center gap-2 text-ink-muted`}>
          <WifiOff className="size-4" />
          Offline, saving on this laptop
        </div>
        <div className={`${chip} ml-8 flex items-center gap-2`}>
          <Check className="size-4 text-success" strokeWidth={3} />
          Back online, all changes synced
        </div>
      </div>
    ),
  },
  {
    title: `${SITE.languages.length} languages, one fair judge.`,
    body: "Write in what you think in. Every language compiles and runs in the same sandbox with the same limits, so nobody gets a faster lane.",
    visual: (
      <div className="flex max-w-[320px] flex-wrap justify-center gap-2.5">
        {SITE.languages.map((language, index) => (
          <span key={language} className={cn(chip, "font-mono", index === 1 && "bg-brand text-brand-ink")}>
            {language}
          </span>
        ))}
      </div>
    ),
  },
  {
    title: "Locked down when it has to be.",
    body: "Colleges can require Safe Exam Browser and lab-network rules. Both are checked on every request, not just once at the door.",
    visual: (
      <div className={`${chip} flex items-center gap-2.5 px-5 py-3 text-[15px]`}>
        <LockKeyhole className="size-4 text-accent" />
        Safe Exam Browser verified
      </div>
    ),
  },
  {
    title: "Every test case, explained.",
    body: "When staff release results you see what passed, what failed and why, test by test. No mystery marks.",
    visual: (
      <div className="w-full max-w-[320px] space-y-2 rounded-2xl bg-surface p-5 font-mono text-[13px] shadow-[var(--shadow-panel)]">
        {[
          ["Small input", "passed"],
          ["Duplicates", "passed"],
          ["n = 10^5", "time limit"],
        ].map(([name, verdict]) => (
          <div key={name} className="flex justify-between">
            <span className="text-ink">{name}</span>
            <span className={verdict === "passed" ? "text-success" : "text-danger"}>{verdict}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: "Practice in the same room.",
    body: "Practice problems, contests and interview stories from seniors live next to your exams, in the exact editor you'll be tested in.",
    visual: (
      <div className="flex flex-col items-center gap-3">
        {["Practice", "Contests", "Interview stories"].map((label, index) => (
          <span key={label} className={chip} style={{ transform: `rotate(${(index - 1) * 3}deg)` }}>
            {label}
          </span>
        ))}
      </div>
    ),
  },
  {
    title: "Copying shows up.",
    body: "After an exam staff can run a similarity check across every submission, so honest marks stay honest.",
    visual: (
      <div className="w-full max-w-[300px] rounded-2xl bg-surface p-5 shadow-[var(--shadow-panel)]">
        <p className="text-[13px] text-ink-subtle">Similarity, question 2</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full w-[91%] rounded-full bg-danger" />
        </div>
        <p className="mt-2 text-[14px] text-ink">2 submissions, 91% alike</p>
      </div>
    ),
  },
];
