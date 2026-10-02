import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { Card, PageHeader, buttonClass, inputClass } from "@/components/ui";

export const dynamic = "force-dynamic";

const PAGE = 200;

const LABEL: Record<string, string> = {
  "students.import": "Imported students",
  "staff.create": "Created staff account",
  "password.reset": "Reset password",
  "batch.reissue": "Reissued batch passwords",
  "user.disable": "Disabled user",
  "user.enable": "Enabled user",
  "question.create": "Created question",
  "question.update": "Edited question",
  "question.regrade": "Regraded question",
  "exam.create": "Created exam",
  "exam.update": "Edited exam",
  "attempt.extend": "Gave extra time",
  "exam.extend": "Extended exam for everyone",
  "exam.announce": "Announced",
  "results.release": "Released results",
  "results.hide": "Hid results",
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; q?: string }> }) {
  const user = await requireUser("admin");
  const { action = "", q = "" } = await searchParams;
  const pattern = `%${q.trim().toLowerCase()}%`;
  const entries = await sql<{ id: string; at: Date; actor: string; action: string; target: string; details: Record<string, unknown> }[]>`
    SELECT id, at, actor, action, target, details FROM audit_log
    WHERE (${action === ""} OR action = ${action})
      AND (${q.trim() === ""} OR lower(actor) LIKE ${pattern} OR lower(target) LIKE ${pattern} OR lower(details::text) LIKE ${pattern})
    ORDER BY id DESC LIMIT ${PAGE}`;

  return (
    <AppShell user={user}>
      <PageHeader eyebrow="Administration" title="Audit log" />
      <p className="mb-6 max-w-2xl text-sm text-muted">Every staff action that changes accounts, questions, exams, time or results, newest first. Entries cannot be edited.</p>
      <form className="mb-4 flex flex-wrap gap-2">
        <select name="action" defaultValue={action} className={`${inputClass} max-w-xs`}>
          <option value="">All actions</option>
          {Object.entries(LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input name="q" defaultValue={q} placeholder="Search person, exam, student…" className={`${inputClass} max-w-sm`} />
        <button className={buttonClass("secondary")}>Filter</button>
        {(action || q) && (
          <Link href="/admin/audit" className={buttonClass("ghost")}>
            Clear
          </Link>
        )}
      </form>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-sunken text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5">When</th>
              <th className="px-4 py-2.5">Who</th>
              <th className="px-4 py-2.5">Action</th>
              <th className="px-4 py-2.5">Target</th>
              <th className="px-4 py-2.5">Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-t border-line align-top">
                <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                  {entry.at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", second: "2-digit" })}
                </td>
                <td className="px-4 py-2.5">{entry.actor}</td>
                <td className="px-4 py-2.5 font-medium">{LABEL[entry.action] ?? entry.action}</td>
                <td className="px-4 py-2.5">{entry.target}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-muted">
                  {Object.entries(entry.details)
                    .filter(([key]) => !key.endsWith("Id"))
                    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
                    .join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && <p className="px-4 py-12 text-center text-sm text-muted">Nothing recorded yet.</p>}
        {entries.length === PAGE && <p className="border-t border-line px-4 py-3 text-xs text-faint">Showing the latest {PAGE}. Filter to narrow down.</p>}
      </Card>
    </AppShell>
  );
}
