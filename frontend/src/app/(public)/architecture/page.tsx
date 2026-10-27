import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Architecture",
  description: "How AetherCode is built: a gateway in front of isolated services, row-level security per college, and a sandboxed judge.",
  alternates: { canonical: "/architecture" },
};

const SERVICES = [
  ["identity", "Sign-in, passwords, sessions"],
  ["tenant", "Colleges, departments, batches"],
  ["user", "Accounts, roles, permissions"],
  ["question-bank", "Questions, test cases, practice"],
  ["assessment", "Exams, pools, schedules"],
  ["submission", "Attempts, runs, grading"],
  ["seb", "Safe Exam Browser lockdown"],
  ["notification", "Notices, community"],
  ["analytics", "Results, reports"],
] as const;

function Box({ title, children, tone = "plain", className = "" }: { title: string; children?: ReactNode; tone?: "plain" | "dark" | "accent"; className?: string }) {
  const tones = {
    plain: "border-line bg-surface",
    dark: "border-transparent bg-[#0f0b1e] text-[#f3eeff]",
    accent: "border-accent/40 bg-brand-soft",
  };
  return (
    <div className={`rounded-[var(--radius-control)] border px-4 py-3 ${tones[tone]} ${className}`}>
      <p className={tone === "dark" ? "text-[14px] font-semibold" : "text-[14px] font-semibold text-ink"}>{title}</p>
      {children && <div className={tone === "dark" ? "mt-0.5 text-[12.5px] text-[#a89fc4]" : "mt-0.5 text-[12.5px] text-ink-muted"}>{children}</div>}
    </div>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div aria-hidden className="flex items-center justify-center gap-2 py-2 text-[12px] text-ink-subtle">
      <span className="h-6 w-px bg-line-strong" />
      {label}
    </div>
  );
}

const PRINCIPLES = [
  {
    title: "One door in",
    body: "Browsers only ever talk to the web app, and the web app only talks to the gateway. The gateway checks sessions, rate limits and Safe Exam Browser keys before anything reaches a service.",
  },
  {
    title: "Colleges can't see each other",
    body: "Every row carries its college, and PostgreSQL row-level security enforces it inside the database. Each service has its own database and least-privilege role.",
  },
  {
    title: "Code runs in a box",
    body: "Submissions are queued to the judge, which runs them in the execution engine with no network, fresh workspaces and hard CPU, memory and time limits. Hidden tests never leave it.",
  },
  {
    title: "Services trust certificates, not networks",
    body: "Every service has its own certificate and identity, and every call between them is mutual TLS.",
  },
  {
    title: "Events, not shared tables",
    body: "Services publish changes on NATS JetStream through an outbox, so a slow consumer never blocks a student's submit.",
  },
  {
    title: "Ships safely",
    body: "Runs on one server with Docker Compose or on Kubernetes with Helm. Releases migrate first, then roll out each service and roll back automatically if it fails to come up.",
  },
];

export default function ArchitecturePage() {
  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-14 sm:pt-20">
      <div className="max-w-[46rem]">
        <h1 className="display text-[2.6rem] text-ink sm:text-[3.4rem]">How AetherCode is built</h1>
        <p className="mt-5 text-[16px] leading-[1.7] text-ink-muted">
          For colleges and recruiters deciding whether to trust it with their exams. The full design, with the reasoning behind each
          decision, is in the <a className="text-ink underline underline-offset-2" href="https://github.com/AlgoQX/AetherCode/tree/HEAD/docs/adr">architecture decision records</a>.
        </p>
      </div>

      <figure className="mt-14 rounded-[var(--radius-surface)] border border-line bg-surface-2 p-5 sm:p-8">
        <figcaption className="sr-only">
          Students and staff use the web app, which calls the gateway. The gateway routes to nine services, each with its own database.
          The submission service sends code to the judge, which runs it in the sandboxed execution engine.
        </figcaption>
        <div aria-hidden className="mx-auto max-w-4xl">
          <div className="grid gap-3 sm:grid-cols-2">
            <Box title="Students">Exams, practice, results</Box>
            <Box title="Staff">Authoring, monitoring, grading</Box>
          </div>
          <Arrow label="HTTPS" />
          <Box title="Web app" tone="dark">Next.js, server-rendered. Holds no data of its own.</Box>
          <Arrow label="HTTPS" />
          <Box title="Gateway" tone="accent">Sessions, rate limits, Safe Exam Browser key checks, lab network rules</Box>
          <Arrow label="mutual TLS" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SERVICES.map(([name, purpose]) => (
              <Box key={name} title={name}>
                {purpose}
                <span className="mt-1.5 block font-mono text-[11px] text-ink-subtle">PostgreSQL + RLS</span>
              </Box>
            ))}
          </div>
          <Arrow label="submission queues code" />
          <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
            <Box title="Judge">Own database and queue, retries, weighted scoring</Box>
            <Box title="Execution engine" tone="dark">Sandboxed runs: no network, hard CPU, memory and time limits</Box>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Box title="NATS JetStream">Events between services</Box>
            <Box title="MinIO">Encrypted files and exports</Box>
          </div>
        </div>
      </figure>

      <div className="mt-16 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {PRINCIPLES.map((principle) => (
          <section key={principle.title}>
            <h2 className="font-serif text-[1.4rem] leading-snug text-ink">{principle.title}</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{principle.body}</p>
          </section>
        ))}
      </div>

      <p className="mt-16 text-[15px] text-ink-muted">
        Security details and how to report an issue are on the <Link href="/security" className="text-ink underline underline-offset-2">security page</Link>.
      </p>
    </div>
  );
}
