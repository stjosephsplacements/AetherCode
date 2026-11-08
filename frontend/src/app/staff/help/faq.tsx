"use client";

import { CaretDown } from "@phosphor-icons/react/ssr";
import { Accordion } from "radix-ui";

export const FAQ = [
  { q: "Why is a page in the sidebar greyed out?", a: "Pages unlock in the order things depend on each other. Departments need a college, students need a batch, and exams need questions and a batch. Hover the lock to see what to do first." },
  { q: "What is the difference between a department, a batch and a placement department?", a: "A department (for example Computer Science) belongs to a college. A batch is one year of it. Placement departments are the hiring teams students are tracked under." },
  { q: "How do I add many students at once?", a: "Open Students, choose Import, and drop a CSV on the panel. Download the template there to see the columns." },
  { q: "A student cannot sign in.", a: "Open Students, find them, and reset their password. They are shown a one-time password to hand over. Check that the account is not disabled." },
  { q: "Who can see what?", a: "Platform administrators see every college. College administrators manage their own college. Faculty, mentors and placement staff see only their area. Permissions shows the exact roles." },
  { q: "Can I change an exam after students have joined?", a: "Questions and timing are locked once an exam has started so every student sits the same paper. Create a new exam or announce a change from the monitor." },
  { q: "When do students see their results?", a: "Only after you release them from the exam page." },
  { q: "Where do I see who changed what?", a: "The Audit log lists every change with the person and time." },
];

export function FaqList() {
  return (
    <Accordion.Root type="single" collapsible className="divide-y divide-line rounded-[var(--radius-surface)] border border-line bg-surface">
      {FAQ.map((item) => (
        <Accordion.Item key={item.q} value={item.q}>
          <Accordion.Header>
            <Accordion.Trigger className="group flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left text-sm font-medium text-ink hover:bg-hover">
              {item.q}
              <CaretDown className="size-4 shrink-0 text-ink-muted transition-transform group-data-[state=open]:rotate-180" />
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content className="px-5 pb-4 text-sm leading-relaxed text-ink-muted">{item.a}</Accordion.Content>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  );
}
