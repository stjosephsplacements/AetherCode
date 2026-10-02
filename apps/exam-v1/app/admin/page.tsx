import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, PageHeader, inputClass, buttonClass } from "@/components/ui";
import { ImportStudents } from "./import-students";
import { CreateStaff, ReissueBatch, ResetPassword } from "./staff-forms";
import { setDisabled } from "./actions";

const PAGE = 100;

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ q?: string; batch?: string }> }) {
  const user = await requireUser("admin");
  const { q = "", batch = "" } = await searchParams;
  const batches = await sql<{ batch: string; count: number }[]>`
    SELECT batch, count(*)::int AS count FROM users WHERE role = 'student' AND batch IS NOT NULL
    GROUP BY batch ORDER BY batch`;
  const pattern = `%${q.trim().toLowerCase()}%`;
  const people = await sql<{ id: string; username: string; name: string; role: string; batch: string | null; disabled: boolean }[]>`
    SELECT id, username, name, role, batch, disabled FROM users
    WHERE (${q.trim() === ""} OR lower(username) LIKE ${pattern} OR lower(name) LIKE ${pattern})
      AND (${batch === ""} OR batch = ${batch})
    ORDER BY role, batch NULLS FIRST, username
    LIMIT ${PAGE}`;

  return (
    <AppShell user={user}>
      <PageHeader eyebrow="Administration" title="People" />
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <ImportStudents />
        <div className="grid gap-6">
          <CreateStaff />
          <ResetPassword />
        </div>
      </div>

      <div className="mt-6">
        <ReissueBatch batches={batches.map((row) => row.batch)} />
      </div>

      <section className="mt-12">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-display text-2xl font-semibold tracking-tight">Directory</h2>
          {batches.map((row) => (
            <Link
              key={row.batch}
              href={`/admin?batch=${encodeURIComponent(row.batch)}`}
              className={buttonClass(row.batch === batch ? "primary" : "secondary", "sm")}
            >
              {row.batch} · {row.count}
            </Link>
          ))}
          {batch && (
            <Link href="/admin" className={buttonClass("ghost", "sm")}>
              Clear
            </Link>
          )}
        </div>
        <form className="mb-4">
          {batch && <input type="hidden" name="batch" value={batch} />}
          <input name="q" defaultValue={q} placeholder="Search by name or roll number" className={`${inputClass} max-w-md`} />
        </form>
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-sunken text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5">Username</th>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Batch</th>
                <th className="px-4 py-2.5 text-right">Access</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.id} className="border-t border-line">
                  <td className="px-4 py-2.5 font-medium">{person.username}</td>
                  <td className="px-4 py-2.5">{person.name}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={person.role === "student" ? "neutral" : "brand"}>{person.role}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{person.batch ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    {person.id !== user.id && (
                      <form action={setDisabled.bind(null, person.id, !person.disabled)}>
                        <button className={buttonClass(person.disabled ? "secondary" : "ghost", "sm")}>
                          {person.disabled ? "Enable" : "Disable"}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {people.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted">No one matches.</p>}
          {people.length === PAGE && <p className="border-t border-line px-4 py-3 text-xs text-faint">Showing the first {PAGE}. Narrow your search.</p>}
        </Card>
      </section>
    </AppShell>
  );
}
