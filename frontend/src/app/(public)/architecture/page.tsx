import type { Icon } from "@phosphor-icons/react";
import { Broadcast, Cube, Door, Lock, Package, Rocket, ShieldCheck } from "@phosphor-icons/react/ssr";
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

function Node({ title, children, tone = "plain", mono }: { title: string; children?: ReactNode; tone?: "plain" | "dark" | "accent"; mono?: string }) {
  const tones = {
    plain: "border-line bg-surface",
    dark: "border-transparent bg-[#0f0b1e] text-[#f3eeff]",
    accent: "border-brand/30 bg-brand-soft",
  };
  const dark = tone === "dark";
  return (
    <div className={`rounded-[var(--radius-surface)] border px-4 py-3.5 shadow-[var(--shadow-hairline)] ${tones[tone]}`}>
      <p className={`text-[14.5px] font-semibold ${dark ? "" : "text-ink"}`}>{title}</p>
      {children && <p className={`mt-1 text-[12.5px] leading-snug ${dark ? "text-[#a89fc4]" : "text-ink-muted"}`}>{children}</p>}
      {mono && <p className="mt-2 inline-block rounded-full bg-hover px-2 py-0.5 font-mono text-[10.5px] text-ink-subtle">{mono}</p>}
    </div>
  );
}

/** One labelled band of the diagram. */
function Layer({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-surface)] border border-line bg-surface-2 p-3 sm:p-4">
      <p className="mb-3 px-1 font-mono text-[11.5px] uppercase tracking-[0.08em] text-ink-subtle">{label}</p>
      {children}
    </div>
  );
}

function Link2({ label }: { label: string }) {
  return (
    <div aria-hidden className="flex flex-col items-center py-1.5">
      <span className="h-4 w-px bg-line-strong" />
      <span className="rounded-full border border-line bg-surface px-3 py-0.5 font-mono text-[11px] text-ink-muted">{label}</span>
      <span className="h-4 w-px bg-line-strong" />
    </div>
  );
}

const FACTS = [
  ["9", "services, each with its own database"],
  ["mTLS", "on every call between services"],
  ["RLS", "row-level security per college"],
  ["0", "network access for submitted code"],
];

const PRINCIPLES: { icon: Icon; title: string; body: string }[] = [
  {
    icon: Door,
    title: "One door in",
    body: "Browsers only ever talk to the web app, and the web app only talks to the gateway. The gateway checks sessions, rate limits and Safe Exam Browser keys before anything reaches a service.",
  },
  {
    icon: ShieldCheck,
    title: "Colleges can't see each other",
    body: "Every row carries its college, and PostgreSQL row-level security enforces it inside the database. Each service has its own database and least-privilege role.",
  },
  {
    icon: Package,
    title: "Code runs in a box",
    body: "Submissions are queued to the judge, which runs them in the execution engine with no network, fresh workspaces and hard CPU, memory and time limits. Hidden tests never leave it.",
  },
  {
    icon: Lock,
    title: "Services trust certificates, not networks",
    body: "Every service has its own certificate and identity, and every call between them is mutual TLS.",
  },
  {
    icon: Broadcast,
    title: "Events, not shared tables",
    body: "Services publish changes on NATS JetStream through an outbox, so a slow consumer never blocks a student's submit.",
  },
  {
    icon: Rocket,
    title: "Ships safely",
    body: "Runs on one server with Docker Compose or on Kubernetes with Helm. Releases migrate first, then roll out each service and roll back automatically if it fails to come up.",
  },
];

export default function ArchitecturePage() {
  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-12 sm:pt-16">
      <header className="mx-auto max-w-[46rem] text-center">
        <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 font-mono text-[12px] text-ink-muted">
          <Cube className="size-3.5 text-brand" /> Architecture
        </p>
        <h1 className="display mt-5 text-[2.6rem] text-ink sm:text-[3.4rem]">How AetherCode is built</h1>
        <p className="mt-5 text-[16px] leading-[1.7] text-ink-muted">
          For colleges and recruiters deciding whether to trust it with their exams. The full design, with the reasoning behind each
          decision, is in the <a className="text-ink underline underline-offset-2" href="https://github.com/AlgoQX/AetherCode/tree/HEAD/docs/adr">architecture decision records</a>.
        </p>
      </header>

      <dl data-reveal className="mt-12 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {FACTS.map(([value, label]) => (
          <div key={label} className="rounded-[var(--radius-surface)] border border-line bg-surface p-5 shadow-[var(--shadow-hairline)]">
            <dt className="font-mono text-[1.9rem] font-semibold leading-none text-ink">{value}</dt>
            <dd className="mt-2 text-[13px] leading-snug text-ink-muted">{label}</dd>
          </div>
        ))}
      </dl>

      <figure data-reveal className="mt-10 rounded-[calc(var(--radius-surface)+6px)] border border-line bg-surface p-3 shadow-[var(--shadow-panel)] sm:p-6">
        <figcaption className="sr-only">
          Students and staff use the web app, which calls the gateway. The gateway routes to nine services, each with its own database.
          The submission service sends code to the judge, which runs it in the sandboxed execution engine.
        </figcaption>
        <div aria-hidden className="mx-auto max-w-4xl">
          <Layer label="People">
            <div className="grid gap-3 sm:grid-cols-2">
              <Node title="Students">Exams, practice, results</Node>
              <Node title="Staff">Authoring, monitoring, grading</Node>
            </div>
          </Layer>
          <Link2 label="HTTPS" />
          <Layer label="Edge">
            <div className="grid gap-3 sm:grid-cols-2">
              <Node title="Web app" tone="dark">Next.js, server-rendered. Holds no data of its own.</Node>
              <Node title="Gateway" tone="accent">Sessions, rate limits, Safe Exam Browser key checks, lab network rules</Node>
            </div>
          </Layer>
          <Link2 label="mutual TLS" />
          <Layer label="Services">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {SERVICES.map(([name, purpose]) => (
                <Node key={name} title={name} mono="PostgreSQL + RLS">{purpose}</Node>
              ))}
            </div>
          </Layer>
          <Link2 label="submission queues code" />
          <Layer label="Execution">
            <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
              <Node title="Judge">Own database and queue, retries, weighted scoring</Node>
              <Node title="Execution engine" tone="dark">Sandboxed runs: no network, hard CPU, memory and time limits</Node>
            </div>
          </Layer>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Node title="NATS JetStream">Events between services</Node>
            <Node title="MinIO">Encrypted files and exports</Node>
          </div>
        </div>
      </figure>

      <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PRINCIPLES.map(({ icon: Icon, title, body }, index) => (
          <section key={title} data-reveal className="rounded-[var(--radius-surface)] border border-line bg-surface p-6 shadow-[var(--shadow-hairline)] transition-shadow hover:shadow-[var(--shadow-panel)]">
            <div className="flex items-center justify-between">
              <span className="grid size-10 place-items-center rounded-full bg-brand-soft text-brand"><Icon className="size-[18px]" /></span>
              <span aria-hidden className="font-mono text-[12px] text-ink-subtle">{String(index + 1).padStart(2, "0")}</span>
            </div>
            <h2 className="mt-5 text-[1.15rem] font-semibold leading-snug text-ink">{title}</h2>
            <p className="mt-2 text-[14.5px] leading-relaxed text-ink-muted">{body}</p>
          </section>
        ))}
      </div>

      <p className="mt-14 text-center text-[15px] text-ink-muted">
        Security details and how to report an issue are on the <Link href="/security" className="text-ink underline underline-offset-2">security page</Link>.
      </p>
    </div>
  );
}
