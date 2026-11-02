"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Flow = { id: string; title: string; steps: { page: string; title: string; text: string; fields: string[]; action: string }[] };

const FLOWS: Flow[] = [
  {
    id: "setup",
    title: "Set up a college",
    steps: [
      { page: "Colleges", title: "Create the college", text: "Only platform administrators do this. Give it a name and a short code.", fields: ["Name", "Short code"], action: "Create college" },
      { page: "Departments", title: "Add departments", text: "For example Computer Science. Departments hold batches and staff.", fields: ["Department name", "Code"], action: "Add department" },
      { page: "Departments", title: "Add a batch", text: "A batch is one year of a department, such as 2022 to 2026.", fields: ["Batch name", "Academic year"], action: "Add batch" },
      { page: "Students", title: "Enrol students", text: "Add one student, or drop a CSV on the import panel. A template is available to download.", fields: ["Roll number", "Name", "Batch"], action: "Import" },
    ],
  },
  {
    id: "exam",
    title: "Run an exam",
    steps: [
      { page: "Questions", title: "Write questions", text: "Multiple choice or coding, with hidden tests. Tag them so they are easy to find.", fields: ["Title", "Statement", "Test cases"], action: "Publish" },
      { page: "Exams", title: "Create the exam", text: "Choose the questions, the batch, the duration and the open window.", fields: ["Title", "Batch", "Opens at", "Duration"], action: "Schedule" },
      { page: "Dashboard", title: "Watch it live", text: "Students appear as they join. Announcements reach everyone in the room.", fields: ["Joined", "Submitted", "Flags"], action: "Open monitor" },
      { page: "Exams", title: "Release results", text: "Review the scores, then release them to students when you are ready.", fields: ["Scores", "Similarity"], action: "Release" },
    ],
  },
  {
    id: "people",
    title: "Add staff and mentors",
    steps: [
      { page: "Staff accounts", title: "Invite a staff member", text: "Enter their name and email. They get a link to set their password.", fields: ["Name", "Email"], action: "Add" },
      { page: "Permissions", title: "Choose their role", text: "College admin, faculty, mentor or placement staff. Each sees only what they need.", fields: ["Role", "Department"], action: "Save" },
    ],
  },
];

const STEP_MS = 3600;

export function FlowPlayer() {
  const [flowId, setFlowId] = useState(FLOWS[0]!.id);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const flow = FLOWS.find((f) => f.id === flowId)!;
  const step = flow.steps[index]!;

  useEffect(() => {
    if (!playing || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % flow.steps.length), STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, index, flow]);

  return (
    <div className="overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
      <div role="tablist" aria-label="Walkthroughs" className="flex gap-1 border-b border-line p-2">
        {FLOWS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={f.id === flowId}
            onClick={() => {
              setFlowId(f.id);
              setIndex(0);
            }}
            className={cn("rounded-full px-3.5 py-1.5 text-[13px] transition-colors", f.id === flowId ? "bg-hover font-medium text-ink" : "text-ink-muted hover:text-ink")}
          >
            {f.title}
          </button>
        ))}
      </div>

      <div className="grid gap-6 p-6 md:grid-cols-[1fr_1.1fr]">
        <div key={`${flowId}-${index}`} className="animate-enter">
          <p className="font-mono text-xs text-ink-subtle">
            Step {index + 1} of {flow.steps.length} · {step.page}
          </p>
          <h3 className="mt-1 text-lg font-semibold text-ink">{step.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">{step.text}</p>
        </div>

        {/* A miniature of the form the step uses; fields fill in one by one, then the button is pressed. */}
        <div key={`${flowId}-${index}-scene`} aria-hidden className="rounded-[var(--radius-control)] border border-line-strong bg-canvas p-4">
          <p className="mb-3 text-xs font-medium text-ink-muted">{step.page}</p>
          <div className="space-y-2.5">
            {step.fields.map((field, i) => (
              <div key={field}>
                <p className="mb-1 text-[11px] text-ink-subtle">{field}</p>
                <div className="h-7 overflow-hidden rounded-md border border-line bg-surface">
                  <div className="h-full rounded-md bg-hover motion-safe:animate-[flow-fill_700ms_ease-out_both]" style={{ animationDelay: `${300 + i * 500}ms`, width: `${55 + ((i * 17) % 35)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div
            className="mt-4 inline-block rounded-full bg-brand px-4 py-1.5 text-xs font-medium text-brand-ink motion-safe:animate-[flow-press_600ms_ease-out_both]"
            style={{ animationDelay: `${400 + step.fields.length * 500}ms` }}
          >
            {step.action}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-line px-4 py-2.5">
        <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"} className="grid size-8 place-items-center rounded-full text-ink-muted hover:bg-hover hover:text-ink">
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <div className="flex flex-1 gap-1.5">
          {flow.steps.map((s, i) => (
            <button key={s.title} type="button" aria-label={`Step ${i + 1}: ${s.title}`} onClick={() => setIndex(i)} className="group h-5 flex-1">
              <span className="relative block h-1 overflow-hidden rounded-full bg-line">
                <span
                  key={`${index}-${playing}`}
                  className={cn("absolute inset-y-0 left-0 rounded-full bg-brand", i < index && "w-full", i > index && "w-0")}
                  style={i === index ? { animation: playing ? `flow-bar ${STEP_MS}ms linear both` : undefined, width: playing ? undefined : "100%" } : undefined}
                />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
