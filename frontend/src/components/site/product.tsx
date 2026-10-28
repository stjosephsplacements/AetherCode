import { Check, CloudOff, Globe2, LockKeyhole, Megaphone, TimerReset, X } from "lucide-react";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

/** The staff and results side of the product, each shown as a large panel built from the real screen's columns and wording. */
export function Product() {
  return (
    <div id="product" className="scroll-mt-20">
      <Feature
        title="Watch the exam as it happens."
        body="The live monitor shows every student's status, questions answered and time left. Add time for one student, or send an announcement to every screen."
      >
        <Panel title="Live monitor" action="Send to everyone">
          <table className="w-full text-left text-[13px]">
            <thead className="text-ink-subtle">
              <tr className="border-b border-line">
                {["Roll number", "Status", "Answered", "Time left", ""].map((heading) => (
                  <th key={heading} className="px-5 py-2.5 font-normal">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MONITOR.map(([roll, status, answered, left]) => (
                <tr key={roll} className="border-b border-line last:border-0">
                  <td className="px-5 py-2.5 font-mono">{roll}</td>
                  <td className="px-5 py-2.5">
                    <span className={cn("inline-flex items-center gap-1.5", status === "In progress" ? "text-ink" : "text-ink-muted")}>
                      <span className={cn("size-1.5 rounded-full", status === "In progress" ? "bg-success" : status === "Handed in" ? "bg-ink-subtle" : "bg-line-strong")} />
                      {status}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 font-mono text-ink-muted">{answered}</td>
                  <td className="px-5 py-2.5 font-mono">{left}</td>
                  <td className="px-5 py-2.5 text-right">
                    {status === "In progress" && <span className="rounded-[6px] border border-line-strong px-2 py-0.5 text-[12px]">Add time</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </Feature>

      <Feature
        title="Marks you can explain."
        body="Grading runs every submission against hidden tests. Marks stay hidden until faculty release them; then each question shows its score and every test's verdict, and staff can check the similarity report first."
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <Panel title="Your score">
            <div className="px-5 pb-5">
              <p className="text-[2.6rem] font-bold tabular-nums tracking-[-0.04em]">
                47 <span className="text-[1.4rem] font-medium text-ink-muted">/ 60</span>
              </p>
              <ul className="mt-3 divide-y divide-line rounded-[10px] border border-line">
                {RESULTS.map(([title, score, tests]) => (
                  <li key={title} className="px-4 py-3">
                    <div className="flex justify-between text-[14px]">
                      <span>{title}</span>
                      <span className="font-mono">{score}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {tests.map((verdict, index) => (
                        <span
                          key={index}
                          className={cn("rounded-md px-2 py-0.5 font-mono text-[11px]", verdict === "passed" ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}
                        >
                          Test {index + 1} {verdict}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
          <Panel title="Similarity">
            <ul className="divide-y divide-line text-[13.5px]">
              {SIMILARITY.map(([question, pair, percent]) => (
                <li key={pair} className="px-5 py-3">
                  <div className="flex justify-between">
                    <span>{question}</span>
                    <span className="font-mono">{percent}%</span>
                  </div>
                  <p className="mt-0.5 font-mono text-[12px] text-ink-subtle">{pair}</p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
                    <div className={cn("h-full rounded-full", Number(percent) > 80 ? "bg-danger" : "bg-ink-subtle")} style={{ width: `${percent}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </Feature>

      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <h2 className="heading max-w-[20ch] text-[2.2rem] text-ink sm:text-[2.8rem]">The details that decide an exam day.</h2>
        <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(({ icon: Icon, title, body }) => (
            <li key={title} data-reveal>
              <Icon className="size-5 text-ink" strokeWidth={1.75} />
              <h3 className="mt-4 text-[16px] font-semibold text-ink">{title}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-ink-muted">{body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Feature({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-16">
        <h2 className="heading text-[2.2rem] text-ink sm:text-[2.8rem]">{title}</h2>
        <p data-reveal className="max-w-[34rem] text-[17px] leading-relaxed text-ink-muted lg:pt-2">
          {body}
        </p>
      </div>
      <div data-reveal className="mt-12">
        {children}
      </div>
    </section>
  );
}

function Panel({ title, action, children }: { title: string; action?: string; children: React.ReactNode }) {
  return (
    <div aria-hidden className="overflow-hidden rounded-[14px] border border-line-strong bg-surface shadow-[var(--shadow-panel)]">
      <div className="flex items-center justify-between border-b border-line px-5 py-3 text-[13px]">
        <span className="font-medium text-ink">{title}</span>
        {action && (
          <span className="inline-flex items-center gap-1.5 rounded-[7px] border border-line-strong px-2.5 py-1 text-[12.5px] text-ink">
            <Megaphone className="size-3.5" />
            {action}
          </span>
        )}
      </div>
      <div className="pt-1 text-ink">{children}</div>
    </div>
  );
}

const MONITOR = [
  ["21CS042", "In progress", "2 / 3", "18:04"],
  ["21CS047", "In progress", "1 / 3", "23:40"],
  ["21CS051", "Handed in", "3 / 3", "-"],
  ["21CS057", "In progress", "3 / 3", "18:04"],
  ["21CS063", "Not started", "0 / 3", "60:00"],
] as const;

const RESULTS = [
  ["Second largest", "20 / 20", ["passed", "passed", "passed"]],
  ["Balanced brackets", "15 / 20", ["passed", "passed", "passed", "wrong answer"]],
  ["Shortest route", "12 / 20", ["passed", "passed", "time limit exceeded"]],
] as const;

const SIMILARITY = [
  ["Question 2", "21CS042 and 21CS057", "91"],
  ["Question 1", "21CS047 and 21CS063", "64"],
  ["Question 3", "21CS051 and 21CS042", "38"],
] as const;

const CAPABILITIES = [
  { icon: Check, title: `${SITE.languages.length} languages`, body: `${SITE.languages.join(", ")}, compiled and run in the same sandbox with the same limits.` },
  { icon: LockKeyhole, title: "Safe Exam Browser", body: "Staff can require it per exam; every request from the exam is checked against its configuration." },
  { icon: Globe2, title: "Lab networks", body: "Limit an exam to the college's own networks so it can only be taken from the labs." },
  { icon: CloudOff, title: "Survives a dropped connection", body: "Code is kept on the laptop while offline and saved as soon as it's back. The timer keeps running." },
  { icon: TimerReset, title: "Extra time per student", body: "Add minutes for one student from the monitor without touching anyone else's clock." },
  { icon: X, title: "No mystery marks", body: "Released results show each test's verdict, like wrong answer or time limit exceeded, never the hidden inputs." },
];
