import { ArrowRight, BookOpenText, Code, FileText, Laptop, Trophy, UserCircle } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Panel } from "@/components/ui/card";
import { requireViewer } from "@/lib/server/session";

export const metadata: Metadata = { title: "Get started" };

const STEPS = [
  {
    icon: Laptop,
    title: "Check your setup",
    text: "Make sure your browser and network are ready for exams.",
    href: "/system-check",
    cta: "Run system check",
  },
  {
    icon: BookOpenText,
    title: "Try a practice problem",
    text: "Write code, run it against sample tests, then submit. Nothing here counts for exams.",
    href: "/student/practice",
    cta: "Open practice",
  },
  {
    icon: Code,
    title: "See your exams",
    text: "Your assigned exams show here with their time window and duration.",
    href: "/student/exams",
    cta: "My exams",
  },
  {
    icon: Trophy,
    title: "Track your performance",
    text: "Scores, streaks and practice progress in one place.",
    href: "/student/performance",
    cta: "Performance",
  },
  {
    icon: UserCircle,
    title: "Set up your profile",
    text: "Link your coding accounts (LeetCode, GitHub) to show your numbers here.",
    href: "/student/profile",
    cta: "My profile",
  },
  {
    icon: FileText,
    title: "Read the help page",
    text: "Answers to what students ask most during exams.",
    href: "/student/help",
    cta: "Help",
  },
];

export default async function StudentGetStarted() {
  const viewer = await requireViewer();
  const firstName = viewer.displayName.split(" ")[0] || viewer.username;

  return (
    <div className="mx-auto max-w-3xl animate-enter">
      <div className="mb-8">
        <p className="font-[family-name:var(--font-eyebrow)] text-[10.5px] uppercase tracking-[0.14em] text-ink-subtle">Welcome</p>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink">Hey {firstName}, here is how things work</h1>
        <p className="mt-2 text-sm text-ink-muted">A quick tour of what you can do. Each card links to the page it talks about.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {STEPS.map((step) => {
          const Icon = step.icon;
          return (
            <Link key={step.href} href={step.href} className="group">
              <Panel className="flex h-full flex-col gap-3 p-5 transition-shadow group-hover:shadow-[var(--shadow-panel)]">
                <Icon className="size-6 text-brand" />
                <div>
                  <p className="text-[15px] font-semibold text-ink">{step.title}</p>
                  <p className="mt-1 text-[13px] leading-snug text-ink-muted">{step.text}</p>
                </div>
                <span className="mt-auto inline-flex items-center gap-1 text-[13px] font-medium text-brand">
                  {step.cta} <ArrowRight className="size-3.5" />
                </span>
              </Panel>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
