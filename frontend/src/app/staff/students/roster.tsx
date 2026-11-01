"use client";

import { ArrowDownAZ, ArrowUpAZ, Download, KeyRound, ListFilter, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Popover } from "radix-ui";
import { useMemo, useState, useTransition } from "react";
import { CredentialsTable } from "@/components/staff/credentials";
import { ConfirmDelete } from "@/components/staff/confirm-delete";
import { EditDialog } from "@/components/staff/edit-dialog";
import { Table } from "@/components/staff/page-header";
import { LocalPager } from "@/components/staff/pager";
import { Tile } from "@/components/staff/tile";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { paginate } from "@/lib/paginate";
import { cn } from "@/lib/utils";
import { type CredentialsState, bulkResetPasswords, bulkSetStatus, deleteStudent, updateStudent } from "./actions";
import { StudentActions } from "./panels";

export type StudentRow = {
  id: string;
  principalId: string;
  tenantId: string;
  college: string;
  roll: string;
  name: string;
  email: string;
  username: string;
  status: string;
  batchId: string;
  batch: string;
  department: string;
  placementId: string;
  placement: string;
};

type Facet = "college" | "department" | "batch" | "placement" | "status";
const FACETS: { key: Facet; label: string }[] = [
  { key: "college", label: "College" },
  { key: "department", label: "Department" },
  { key: "batch", label: "Batch" },
  { key: "placement", label: "Placement department" },
  { key: "status", label: "Sign-in" },
];

const compare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
// A spreadsheet runs a cell that starts with one of these, so the export escapes it.
const cell = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;

/** Every student in scope: search, filter on five facets, sort, export, select and act in bulk. */
export function Roster({ rows, several }: { rows: StudentRow[]; several: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Record<Facet, Set<string>>>({ college: new Set(), department: new Set(), batch: new Set(), placement: new Set(), status: new Set() });
  const [sort, setSort] = useState<"roll" | "name">("roll");
  const [descending, setDescending] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [issued, setIssued] = useState<CredentialsState["accounts"]>();

  const value = (row: StudentRow, facet: Facet) => (facet === "status" ? (row.status === "active" ? "Can sign in" : "Disabled") : facet === "placement" ? row.placement : row[facet]);
  const options = useMemo(
    () => Object.fromEntries(FACETS.map(({ key }) => [key, [...new Set(rows.map((row) => value(row, key)).filter(Boolean))].sort(compare)])) as Record<Facet, string[]>,
    [rows],
  );

  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const matching = rows.filter(
      (row) =>
        FACETS.every(({ key }) => picked[key].size === 0 || picked[key].has(value(row, key))) &&
        (!needle || row.roll.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle) || row.email.toLowerCase().includes(needle)),
    );
    const sign = descending ? -1 : 1;
    return matching.sort((a, b) => compare(a.college, b.college) || sign * compare(sort === "name" ? a.name || a.roll : a.roll, sort === "name" ? b.name || b.roll : b.roll));
  }, [rows, picked, needle, sort, descending]);
  const paged = paginate(shown, page);
  const filterCount = FACETS.reduce((total, { key }) => total + picked[key].size, 0);
  const active = shown.filter((row) => row.status === "active").length;
  const batches = new Set(shown.map((row) => row.batchId)).size;

  const toggle = (facet: Facet, option: string) => {
    setPicked((current) => {
      const next = new Set(current[facet]);
      if (!next.delete(option)) next.add(option);
      return { ...current, [facet]: next };
    });
    setPage(1);
  };
  const clearFilters = () => {
    setPicked({ college: new Set(), department: new Set(), batch: new Set(), placement: new Set(), status: new Set() });
    setPage(1);
  };

  function exportCsv() {
    const head = ["Roll number", "Name", "Email", "Username", ...(several ? ["College"] : []), "Department", "Batch", "Placement department", "Sign-in"];
    const lines = shown.map((row) => [row.roll, row.name, row.email, row.username, ...(several ? [row.college] : []), row.department, row.batch, row.placement, row.status].map(cell).join(","));
    const url = URL.createObjectURL(new Blob([[head.map(cell).join(","), ...lines].join("\n")], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: `students_${new Date().toISOString().slice(0, 10)}.csv` }).click();
    URL.revokeObjectURL(url);
  }

  const targets = () => rows.filter((row) => selected.has(row.id)).map((row) => ({ principalId: row.principalId, collegeId: row.tenantId, username: row.username }));
  function run(job: () => Promise<{ error: string | null; message?: string | null; accounts?: CredentialsState["accounts"] }>) {
    startTransition(async () => {
      setIssued(undefined);
      const result = await job();
      setNotice(result.error ? { error: true, text: result.error } : result.message ? { error: false, text: result.message } : null);
      if (result.accounts) setIssued(result.accounts);
      if (!result.error) router.refresh();
    });
  }

  const pageIds = paged.rows.map((row) => row.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const colleges = [...new Set(paged.rows.map((row) => row.college))];

  const table = (list: StudentRow[]) => (
    <Table head={["", "Roll number", "Name", "Department", "Placement department", "Status", ""]}>
      {list.map((student) => (
        <tr key={student.id} className={cn(selected.has(student.id) && "bg-brand-soft/40")}>
          <td className="w-10 px-4 py-2.5">
            <input
              type="checkbox"
              aria-label={`Select ${student.roll}`}
              checked={selected.has(student.id)}
              onChange={() => setSelected((current) => { const next = new Set(current); if (!next.delete(student.id)) next.add(student.id); return next; })}
              className="size-4 accent-[var(--brand)]"
            />
          </td>
          <td className="px-4 py-2.5 font-mono text-[13px]">
            <Link href={`/staff/students/${student.id}?college=${student.tenantId}`} className="font-medium text-ink hover:text-brand hover:underline">
              {student.roll}
            </Link>
          </td>
          <td className="px-4 py-2.5">
            <span className="block text-ink">{student.name || <span className="text-ink-subtle">Unnamed</span>}</span>
            {student.email && <span className="block text-[12px] text-ink-muted">{student.email}</span>}
          </td>
          <td className="px-4 py-2.5 text-ink-muted">
            {student.department}
            <span className="block font-mono text-[11px] text-ink-subtle">{student.batch}</span>
          </td>
          <td className="px-4 py-2.5 text-ink-muted">{student.placement}</td>
          <td className="px-4 py-2.5">
            <Badge tone={student.status === "active" ? "success" : "neutral"}>{student.status}</Badge>
          </td>
          <td className="px-4 py-2.5">
            <div className="flex items-center justify-end gap-1">
              <StudentActions principalId={student.principalId} username={student.username} collegeId={student.tenantId} />
              <EditDialog
                title="Edit student"
                description="The roll number must be unique in this college."
                fields={[{ name: "enrollment_number", label: "Roll number", value: student.roll }]}
                onSave={(changes) => updateStudent(student.tenantId, student.id, changes)}
              />
              <ConfirmDelete
                title={`Delete ${student.roll}?`}
                description="The student record is removed. To stop someone signing in without losing anything, turn their account off instead."
                confirmText={student.roll}
                onConfirm={(reason) => deleteStudent(student.tenantId, student.id, reason)}
              />
            </div>
          </td>
        </tr>
      ))}
    </Table>
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Students">
          <p className="font-mono text-[28px] font-semibold leading-none tabular-nums text-ink">{shown.length}</p>
          {shown.length !== rows.length && <p className="mt-2 text-[12px] text-ink-muted">of {rows.length}</p>}
        </Tile>
        <Tile label="Can sign in">
          <p className="font-mono text-[28px] font-semibold leading-none tabular-nums text-ink">{active}</p>
          {shown.length > active && <p className="mt-2 text-[12px] text-ink-muted">{shown.length - active} disabled</p>}
        </Tile>
        <Tile label="Batches">
          <p className="font-mono text-[28px] font-semibold leading-none tabular-nums text-ink">{batches}</p>
        </Tile>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" strokeWidth={1.75} />
          <input
            type="search"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(1); }}
            placeholder="Search roll number, name or email"
            aria-label="Search students"
            className="h-9 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface pl-9 pr-3 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15"
          />
        </div>

        <Popover.Root>
          <Popover.Trigger asChild>
            <Button variant="secondary" size="sm">
              <ListFilter />
              Filters
              {filterCount > 0 && <span className="rounded-full bg-brand-soft px-1.5 font-mono text-[11px] text-brand">{filterCount}</span>}
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="start" sideOffset={6} className="z-50 max-h-[min(70dvh,480px)] w-80 animate-fade overflow-y-auto rounded-[var(--radius-surface)] border border-line-strong bg-surface p-4 shadow-[var(--shadow-overlay)]">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Filters</span>
                {filterCount > 0 && (
                  <button type="button" onClick={clearFilters} className="text-[12px] text-brand hover:underline">
                    Clear all
                  </button>
                )}
              </div>
              {FACETS.filter(({ key }) => (key !== "college" || several) && options[key].length > 0).map(({ key, label }) => (
                <fieldset key={key} className="mb-4 last:mb-0">
                  <legend className="mb-1.5 text-[12px] font-medium text-ink-muted">{label}</legend>
                  <div className="space-y-0.5">
                    {options[key].map((option) => (
                      <label key={option} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink hover:bg-hover">
                        <input type="checkbox" checked={picked[key].has(option)} onChange={() => toggle(key, option)} className="size-4 accent-[var(--brand)]" />
                        <span className="min-w-0 truncate">{option}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <div className="flex items-center gap-1">
          <select
            aria-label="Sort by"
            value={sort}
            onChange={(event) => setSort(event.target.value as "roll" | "name")}
            className="h-8 rounded-full border border-line-strong bg-surface px-3 text-[13px] text-ink outline-none focus:border-brand"
          >
            <option value="roll">Roll number</option>
            <option value="name">Name</option>
          </select>
          <Button variant="ghost" size="icon" aria-label={descending ? "Sorted descending" : "Sorted ascending"} onClick={() => setDescending((current) => !current)}>
            {descending ? <ArrowUpAZ /> : <ArrowDownAZ />}
          </Button>
        </div>

        <Button variant="secondary" size="sm" className="ml-auto" onClick={exportCsv} disabled={shown.length === 0}>
          <Download />
          Export
        </Button>
      </div>

      {selected.size > 0 && (
        <div role="region" aria-label="Selected students" className="flex flex-wrap items-center gap-2 rounded-[var(--radius-surface)] border border-brand/40 bg-brand-soft/40 px-4 py-2.5">
          <span className="mr-auto font-mono text-[13px] tabular-nums text-ink">{selected.size} selected</span>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => run(() => bulkSetStatus(targets(), "active"))}>Enable sign-in</Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => run(() => bulkSetStatus(targets(), "disabled"))}>Disable sign-in</Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => { if (confirm(`Give ${selected.size} student${selected.size === 1 ? "" : "s"} a new password? Their current passwords stop working.`)) run(() => bulkResetPasswords(targets())); }}
          >
            <KeyRound />
            Reset passwords
          </Button>
          <Button variant="ghost" size="icon" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
            <X />
          </Button>
        </div>
      )}
      {notice && <p role={notice.error ? "alert" : "status"} className={cn("text-sm", notice.error ? "text-danger" : "text-success")}>{notice.text}</p>}
      {issued && issued.length > 0 && <CredentialsTable filename="student-passwords.csv" rows={issued.map((account) => ({ username: account.username ?? "", name: account.display_name, password: account.password }))} />}

      {shown.length === 0 ? (
        <div className="rounded-[var(--radius-surface)] border border-dashed border-line-strong px-6 py-12 text-center text-sm text-ink-muted">
          {rows.length === 0 ? "No students yet. Use Enrol student or Bulk import." : "No student matches those filters."}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
          <label className="inline-flex w-fit cursor-pointer items-center gap-2 text-[12.5px] text-ink-muted">
            <input
              type="checkbox"
              checked={allOnPage}
              onChange={() => setSelected((current) => { const next = new Set(current); for (const id of pageIds) { if (allOnPage) next.delete(id); else next.add(id); } return next; })}
              className="size-4 accent-[var(--brand)]"
            />
            Select this page
          </label>
          {shown.length > pageIds.length && (
            <button type="button" onClick={() => setSelected(new Set(shown.map((row) => row.id)))} className="text-[12.5px] text-brand hover:underline">
              Select all {shown.length}
            </button>
          )}
          </div>
          {several && colleges.length > 0
            ? colleges.map((college) => {
                const group = paged.rows.filter((row) => row.college === college);
                return (
                  <section key={college} aria-label={college}>
                    <h3 className="mb-2 flex items-baseline gap-2 text-[14px] font-semibold text-ink">
                      {college}
                      <span className="font-mono text-[11px] font-normal text-ink-subtle">{shown.filter((row) => row.college === college).length} students</span>
                    </h3>
                    {table(group)}
                  </section>
                );
              })
            : table(paged.rows)}
        </div>
      )}
      <LocalPager meta={paged} onPage={setPage} noun="students" />
    </div>
  );
}
