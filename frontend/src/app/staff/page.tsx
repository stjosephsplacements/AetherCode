import { ArrowRight, BookOpen, Building2, NotebookPen, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Panel } from "@/components/ui/card";
import type { Page, QuestionDetail } from "@/lib/api-types";
import { listExams } from "@/lib/server/exams";
import { gateway } from "@/lib/server/gateway";
import { requireStaff } from "@/lib/server/staff";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Overview" };

const ROLE_NAMES: Record<string, string> = {
  super_admin: "Platform administrator",
  college_admin: "College administrator",
  department_user: "Faculty",
  mentor: "Mentor",
  placement_user: "Placement staff",
  student: "Student",
};

async function settle<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

export default async function StaffHome() {
  const staff = await requireStaff();
  const firstName = staff.viewer.displayName.split(" ")[0] || staff.viewer.username;
  const [exams, questions] = await Promise.all([
    staff.tenantId ? settle(listExams(staff.tenantId)) : Promise.resolve(null),
    settle(gateway<Page<QuestionDetail>>("/question-bank/v1/questions?limit=100")),
  ]);
  const now = new Date().toISOString();
  const upcoming = (exams ?? [])
    .filter(({ version }) => version?.status === "published" && version.closes_at > now)
    .sort((a, b) => a.version!.opens_at.localeCompare(b.version!.opens_at))
    .slice(0, 4);

  const steps = [
    { href: "/staff/organisation", icon: Building2, title: "Departments and batches", text: "Set up where students belong.", admin: true },
    { href: "/staff/students", icon: Users, title: "Students", text: "Import a batch and hand out passwords.", admin: true },
    { href: "/staff/questions", icon: BookOpen, title: "Questions", text: `${questions?.items.length ?? 0} published in the shared bank.`, admin: false },
    { href: "/staff/exams", icon: NotebookPen, title: "Exams", text: `${exams?.length ?? 0} in this college.`, admin: false },
  ].filter((step) => !step.admin || staff.canManageAccounts);

  return (
    <div className="animate-enter">
      <h1 className="display text-[2.25rem] text-ink sm:text-[2.6rem]">Welcome back, {firstName}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">{[...new Set(staff.viewer.roles)].map((role) => ROLE_NAMES[role] ?? role).join(", ")}</p>

      {!staff.tenantId && (
        <p className="mt-8 rounded-[var(--radius-surface)] border border-dashed border-line-strong px-5 py-4 text-sm text-ink-muted">
          No college exists yet. Provision one through the platform API, then choose it above.
        </p>
      )}

      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        {steps.map((step) => (
          <Link key={step.href} href={step.href} className="group">
            <Panel className="flex h-full items-start gap-4 p-5 transition-[border-color,box-shadow] group-hover:border-line-strong group-hover:shadow-[var(--shadow-overlay)]">
              <step.icon className="mt-0.5 size-5 shrink-0 text-brand" strokeWidth={1.75} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-ink">{step.title}</span>
                <span className="mt-0.5 block text-sm text-ink-muted">{step.text}</span>
              </span>
              <ArrowRight className="size-4 text-ink-subtle transition-transform group-hover:translate-x-0.5" strokeWidth={1.75} />
            </Panel>
          </Link>
        ))}
      </div>

      {upcoming.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-3 text-sm font-medium text-ink-muted">Upcoming and open exams</h2>
          <ul className="overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
            {upcoming.map(({ exam, version }, index) => (
              <li key={exam.id} className={index > 0 ? "border-t border-line" : undefined}>
                <Link href={`/staff/exams/${exam.id}`} className="flex items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-hover">
                  <span className="truncate text-[15px] font-medium text-ink">{version!.title}</span>
                  <span className="shrink-0 text-[13px] text-ink-muted">{formatDateTime(version!.opens_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
