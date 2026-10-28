import { CloudOff, LockKeyhole } from "lucide-react";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

/** What the platform does, one tile each, sketched with the wording the real screens use. */
export function Bento() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
      <h2 className="max-w-[22ch] heading text-[2.3rem] text-ink sm:text-[3.1rem]">One platform for the exam and the practice before it.</h2>
      <div className="mt-12 grid gap-px overflow-hidden rounded-[16px] border border-line bg-line lg:grid-cols-6">
        <Tile className="lg:col-span-4" title="Six languages" body="Write in C, C++17, Java, Python 3, JavaScript or Go. Run against the sample tests or your own input as often as you like.">
          <div className="flex flex-wrap gap-2">
            {SITE.languages.map((language) => (
              <span key={language} className="rounded-[8px] bg-surface-2 px-3 py-1.5 font-mono text-[13px] text-ink">
                {language}
              </span>
            ))}
          </div>
        </Tile>
        <Tile className="lg:col-span-2" title="Safe Exam Browser and lab networks" body="Staff can require Safe Exam Browser and limit an exam to the college's lab networks.">
          <span className="inline-flex items-center gap-2 rounded-[8px] bg-surface-2 px-3 py-1.5 text-[13.5px] text-ink">
            <LockKeyhole className="size-3.5 text-accent" />
            Safe Exam Browser required
          </span>
        </Tile>
        <Tile className="lg:col-span-3" title="Keeps working offline" body="The timer keeps running, and code the server never received is offered back when the exam reopens on that laptop.">
          <p className="flex items-start gap-2.5 rounded-[10px] bg-warning-soft px-3.5 py-2.5 text-[13.5px] leading-relaxed text-warning">
            <CloudOff className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
            <span>
              <span className="font-medium">You&apos;re offline.</span> Keep coding: your code is kept on this device and saves as soon
              as you&apos;re back.
            </span>
          </p>
        </Tile>
        <Tile className="lg:col-span-3" title="Live monitor" body="Staff see each student's status and time left, add time for one student, and send announcements to every screen.">
          <table className="w-full text-left text-[13px]">
            <thead className="text-ink-subtle">
              <tr>
                <th className="pb-2 font-normal">Roll number</th>
                <th className="pb-2 font-normal">Status</th>
                <th className="pb-2 text-right font-normal">Time left</th>
              </tr>
            </thead>
            <tbody className="font-mono text-ink">
              {[
                ["21CS042", "In progress", "18:04"],
                ["21CS057", "Handed in", "-"],
                ["21CS063", "Not started", "60:00"],
              ].map(([roll, status, left]) => (
                <tr key={roll} className="border-t border-line">
                  <td className="py-1.5">{roll}</td>
                  <td className={cn("py-1.5 font-sans", status === "In progress" ? "text-accent" : "text-ink-muted")}>{status}</td>
                  <td className="py-1.5 text-right">{left}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tile>
        <Tile className="lg:col-span-2" title="Similarity report" body="After the exam, staff compare submissions question by question to find pairs that are too alike.">
          <div>
            <div className="flex justify-between font-mono text-[13px] text-ink">
              <span>Question 2</span>
              <span>91%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full w-[91%] rounded-full bg-danger" />
            </div>
          </div>
        </Tile>
        <Tile className="lg:col-span-2" title="Results, test by test" body="Marks stay hidden until faculty release them. Then each question shows its score and every test's verdict.">
          <div className="flex flex-wrap gap-1.5">
            {[
              ["Test 1 passed", true],
              ["Test 2 passed", true],
              ["Test 3 time limit exceeded", false],
            ].map(([label, ok]) => (
              <span key={String(label)} className={cn("rounded-md px-2 py-0.5 font-mono text-[11.5px]", ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
                {label}
              </span>
            ))}
          </div>
        </Tile>
        <Tile className="lg:col-span-2" title="Practice and community" body="Practice problems, contest and hackathon listings, and interview experiences from seniors that staff approve.">
          <div className="flex flex-wrap gap-1.5">
            {["Practice", "Contests", "Hackathons", "Interviews"].map((label) => (
              <span key={label} className="rounded-[8px] bg-surface-2 px-3 py-1.5 text-[13px] text-ink">
                {label}
              </span>
            ))}
          </div>
        </Tile>
      </div>
    </section>
  );
}

function Tile({ className, title, body, children }: { className?: string; title: string; body: string; children: React.ReactNode }) {
  return (
    <article className={cn("bg-canvas", className)}>
      <div data-reveal className="flex h-full flex-col justify-between gap-10 p-7 sm:p-8">
        <div aria-hidden>{children}</div>
        <div>
          <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
          <p className="mt-1.5 max-w-[34rem] text-[15px] leading-relaxed text-ink-muted">{body}</p>
        </div>
      </div>
    </article>
  );
}
