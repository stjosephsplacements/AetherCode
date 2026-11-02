"use client";

import { ArrowDownAZ, ArrowUpAZ, Download, KeyRound, LoaderCircle, ListFilter, Search, UserRoundX, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Popover } from "radix-ui";
import { type ReactNode, useEffect, useMemo, useState, useTransition } from "react";
import { CredentialsTable } from "@/components/staff/credentials";
import { ConfirmDelete } from "@/components/staff/confirm-delete";
import { EditDialog } from "@/components/staff/edit-dialog";
import { Select } from "@/components/staff/form";
import { LocalPager } from "@/components/staff/pager";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { paginate } from "@/lib/paginate";
import { cn } from "@/lib/utils";
import { type CredentialsState, bulkResetPasswords, bulkSetStatus, deleteStudent, updateAccount, updateStudent } from "./actions";
import { formatPhone, initials, relativeTime } from "./format";
import { StudentActions } from "./panels";

export type StudentRow = {
  id: string;
  principalId: string;
  tenantId: string;
  college: string;
  roll: string;
  name: string;
  email: string;
  phone: string;
  /** ISO timestamps from the account; empty when the account has none (never signed in, not reported). */
  joinedAt: string;
  lastSignIn: string;
  /** "temporary", "set", or empty when unknown. */
  passwordState: string;
  username: string;
  status: string;
  batchId: string;
  batch: string;
  department: string;
  placementId: string;
  placement: string;
  /** The batch's mentors, by name. */
  mentors: string;
};

type Facet = "college" | "department" | "batch" | "mentor" | "placement" | "status" | "password" | "joined" | "signedIn";
const FACETS: { key: Facet; label: string }[] = [
  { key: "college", label: "College" },
  { key: "department", label: "Department" },
  { key: "batch", label: "Batch" },
  { key: "mentor", label: "Mentor" },
  { key: "placement", label: "Placement department" },
  { key: "status", label: "Sign-in" },
  { key: "password", label: "Password" },
  { key: "joined", label: "Joined" },
  { key: "signedIn", label: "Has signed in" },
];

const DAY = 86_400_000;
/** Exclusive buckets, so choosing two of them means "either". */
const JOINED = ["Today", "Past week", "Past month", "Older"] as const;
function joinedBucket(iso: string, now: number): string {
  if (!iso) return "";
  const age = now - new Date(iso).getTime();
  return age < DAY ? "Today" : age < 7 * DAY ? "Past week" : age < 30 * DAY ? "Past month" : "Older";
}
const PASSWORD_LABEL: Record<string, string> = { temporary: "Not changed yet", set: "Changed" };
const when = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

const DEPARTMENT_TONES = ["brand", "success", "warning", "neutral"] as const;
/** The same department always gets the same quiet colour, so a column of them reads at a glance. */
const departmentTone = (name: string) => DEPARTMENT_TONES[[...name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % DEPARTMENT_TONES.length]!;

const emptyFilters = (): Record<Facet, Set<string>> => ({ college: new Set(), department: new Set(), batch: new Set(), mentor: new Set(), placement: new Set(), status: new Set(), password: new Set(), joined: new Set(), signedIn: new Set() });
const compare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
// A spreadsheet runs a cell that starts with one of these, so the export escapes it.
const cell = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;

function facetValue(row: StudentRow, facet: Facet, now: number): string {
  switch (facet) {
    case "status": return row.status === "active" ? "Can sign in" : "Disabled";
    case "placement": return row.placement;
    case "mentor": return row.mentors;
    case "password": return PASSWORD_LABEL[row.passwordState] ?? "";
    case "joined": return joinedBucket(row.joinedAt, now);
    case "signedIn": return row.joinedAt ? (row.lastSignIn ? "Yes" : "Never") : "";
    default: return row[facet];
  }
}

/** Every student in scope: search, filter on five facets, sort, export, select and act in bulk. */
export function Roster({ rows, several, actions }: { rows: StudentRow[]; several: boolean; actions: ReactNode }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [picked, setPicked] = useState<Record<Facet, Set<string>>>(emptyFilters());
  const [sort, setSort] = useState<"roll" | "name">("roll");
  const [descending, setDescending] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [issued, setIssued] = useState<CredentialsState["accounts"]>();

  const [now] = useState(() => Date.now());
  const options = useMemo(
    () =>
      Object.fromEntries(
        FACETS.map(({ key }) => {
          const found = [...new Set(rows.map((row) => facetValue(row, key, now)).filter(Boolean))];
          return [key, key === "joined" ? JOINED.filter((bucket) => found.includes(bucket)) : found.sort(compare)];
        }),
      ) as Record<Facet, string[]>,
    [rows, now],
  );

  useEffect(() => {
    const timer = setTimeout(() => { setDebounced(query); setPage(1); }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const needle = debounced.trim().toLowerCase();
  const shown = useMemo(() => {
    const matching = rows.filter(
      (row) =>
        FACETS.every(({ key }) => picked[key].size === 0 || picked[key].has(facetValue(row, key, now))) &&
        (!needle || row.roll.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle) || row.email.toLowerCase().includes(needle) || row.phone.replace(/\D/g, "").includes(needle.replace(/\D/g, "") || "\u0000")),
    );
    const sign = descending ? -1 : 1;
    return matching.sort((a, b) => compare(a.college, b.college) || sign * compare(sort === "name" ? a.name || a.roll : a.roll, sort === "name" ? b.name || b.roll : b.roll));
  }, [rows, picked, needle, sort, descending, now]);
  const paged = paginate(shown, page);
  const filterCount = FACETS.reduce((total, { key }) => total + picked[key].size, 0);
  const active = shown.filter((row) => row.status === "active").length;
  const disabled = shown.length - active;
  const notSignedIn = shown.filter((row) => row.status === "active" && row.joinedAt && !row.lastSignIn).length;
  const placed = shown.filter((row) => row.placementId).length;
  const onlyBatch = picked.batch.size === 1 ? [...picked.batch][0] : undefined;

  const toggle = (facet: Facet, option: string) => {
    setPicked((current) => {
      const next = new Set(current[facet]);
      if (!next.delete(option)) next.add(option);
      return { ...current, [facet]: next };
    });
    setPage(1);
  };
  /** A toolbar dropdown picks one value (or none) of a facet; the Filters popover can still pick several. */
  const pickOne = (facet: Facet, option: string) => {
    setPicked((current) => ({ ...current, [facet]: new Set(option ? [option] : []) }));
    setPage(1);
  };
  const quick = (facet: Facet, label: string, all: string) => (
    <Select aria-label={label} size="sm" className="w-44" value={picked[facet].size === 0 ? "" : picked[facet].size === 1 ? [...picked[facet]][0]! : "__several"} onValueChange={(option) => pickOne(facet, option === "__several" ? "" : option)}>
      <option value="">{all}</option>
      {picked[facet].size > 1 && <option value="__several" disabled>Several</option>}
      {options[facet].map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </Select>
  );
  const clearFilters = () => {
    setPicked(emptyFilters());
    setPage(1);
  };

  function exportCsv() {
    const head = ["Roll number", "Name", "Email", "Phone", "Username", ...(several ? ["College"] : []), "Department", "Batch", "Mentor", "Placement department", "Sign-in", "Password", "Joined", "Last sign-in"];
    const lines = shown.map((row) => [row.roll, row.name, row.email, row.phone, row.username, ...(several ? [row.college] : []), row.department, row.batch, row.mentors, row.placement, row.status, PASSWORD_LABEL[row.passwordState] ?? "", when(row.joinedAt), when(row.lastSignIn)].map(cell).join(","));
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

  const toggleRow = (id: string) => setSelected((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  const chosen = rows.filter((row) => selected.has(row.id));
  const hiddenSelected = chosen.filter((row) => !shown.includes(row)).length;

  const table = (list: StudentRow[]) => (
    <div className="max-h-[72dvh] overflow-auto rounded-[var(--radius-surface)] border border-line bg-surface">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="sticky top-0 z-10 bg-sidebar shadow-[0_1px_0_var(--line)]">
          <tr>
            <th scope="col" className="w-10 px-4 py-2.5"><span className="sr-only">Select</span></th>
            {["Student", "Department", "Phone", "Account", "Last sign-in"].map((label) => (
              <th key={label} scope="col" className="px-4 py-2.5 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-ink-subtle">{label}</th>
            ))}
            <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="[&_tr]:transition-colors [&_tr:hover]:bg-hover [&_tr+tr]:border-t [&_tr+tr]:border-line">
          {list.map((student) => (
            <tr key={student.id} className={cn(selected.has(student.id) && "bg-brand-soft/40")}>
              <td className="w-10 px-4 py-2.5">
                <input type="checkbox" aria-label={`Select ${student.roll}`} checked={selected.has(student.id)} onChange={() => toggleRow(student.id)} className="size-4 accent-[var(--brand)]" />
              </td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft font-mono text-[12px] font-semibold text-brand-soft-ink">{initials(student.name, student.roll)}</span>
                  <span className="min-w-0">
                    <Link href={`/staff/students/${student.id}?college=${student.tenantId}`} className="block truncate font-medium text-ink hover:text-brand hover:underline">
                      {student.name || <span className="text-ink-subtle">Unnamed</span>}
                    </Link>
                    <span className="block font-mono text-[12px] text-ink-muted">{student.roll}</span>
                    {student.email && <span className="block max-w-56 truncate text-[12px] text-ink-subtle">{student.email}</span>}
                  </span>
                </div>
              </td>
              <td className="px-4 py-2.5">
                {student.department ? <Badge tone={departmentTone(student.department)}>{student.department}</Badge> : <span className="text-ink-subtle">None</span>}
                <span className="mt-1 block font-mono text-[11px] text-ink-subtle">{student.batch}</span>
                {student.placementId && <span className="block text-[11.5px] text-ink-subtle">Placement: {student.placement}</span>}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12.5px] text-ink-muted">{student.phone ? formatPhone(student.phone) : <span className="text-ink-subtle">-</span>}</td>
              <td className="px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={student.status === "active" ? "success" : "neutral"}>{student.status === "active" ? "Active" : "Disabled"}</Badge>
                  {student.passwordState && <Badge tone={student.passwordState === "temporary" ? "warning" : "neutral"}>{student.passwordState === "temporary" ? "Temp password" : "Password set"}</Badge>}
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] text-ink-muted" title={student.lastSignIn ? when(student.lastSignIn) : undefined}>
                {student.lastSignIn ? relativeTime(student.lastSignIn, now) : student.joinedAt ? "Never" : <span className="text-ink-subtle">-</span>}
              </td>
              <td className="px-4 py-2.5">
                <div className="flex items-center justify-end gap-1">
                  <StudentActions principalId={student.principalId} username={student.username} collegeId={student.tenantId} />
                  <EditDialog
                    title="Edit student"
                    description="The roll number must be unique in this college. Name, email and phone belong to the account."
                    fields={[
                      { name: "enrollment_number", label: "Roll number", value: student.roll },
                      { name: "display_name", label: "Name", value: student.name },
                      { name: "email", label: "Email", value: student.email, optional: true, hint: "A new email is not verified until they confirm it." },
                      { name: "phone", label: "Phone", value: student.phone, optional: true },
                    ]}
                    onSave={async (changes) => {
                      const { enrollment_number, ...account } = changes;
                      if (enrollment_number !== undefined) {
                        const result = await updateStudent(student.tenantId, student.id, { enrollment_number });
                        if (result.error) return result;
                      }
                      return Object.keys(account).length > 0 ? updateAccount(student.tenantId, student.principalId, account) : { error: null, message: "Saved." };
                    }}
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
        </tbody>
      </table>
    </div>
  );

  const stat = (label: string, value: number, note?: string) => (
    <div className="flex min-w-0 items-baseline gap-3 rounded-[var(--radius-surface)] border border-line bg-surface px-4 py-3">
      <div className="min-w-0">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-subtle">{label}</p>
        <p className="mt-1 font-mono text-[24px] font-semibold leading-none tabular-nums text-ink">{value}</p>
      </div>
      {note && <p className="ml-auto text-right text-[11.5px] leading-tight text-ink-muted">{note}</p>}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Summary">
        {stat("Total enrolled", shown.length, shown.length !== rows.length ? `of ${rows.length}` : undefined)}
        {stat("Active accounts", active, notSignedIn > 0 ? `${notSignedIn} not signed in yet` : undefined)}
        {stat("Disabled", disabled, disabled > 0 ? "cannot sign in" : undefined)}
        {stat("In a placement department", placed, shown.length > placed ? `${shown.length - placed} without` : undefined)}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {quick("batch", "Batch", "All batches")}
        {quick("department", "Department", "All departments")}
        {quick("placement", "Placement department", "All placements")}
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" strokeWidth={1.75} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search roll number, name, email or phone"
            aria-label="Search students"
            className="h-8 w-full rounded-full border border-line-strong bg-surface pl-9 pr-3 text-[13px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15"
          />
        </div>

        <Popover.Root>
          <Popover.Trigger asChild>
            <Button variant="secondary" size="sm">
              <ListFilter />
              More filters
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

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={shown.length === 0}>
            <Download />
            Export
          </Button>
          {actions}
        </div>
      </div>

      <div aria-live="polite" className="empty:hidden">
        {notice && <p role={notice.error ? "alert" : "status"} className={cn("rounded-[var(--radius-control)] px-3 py-2 text-sm", notice.error ? "bg-danger-soft text-danger" : "bg-success-soft text-success")}>{notice.text}</p>}
      </div>
      {issued && issued.length > 0 && <CredentialsTable filename="student-passwords.csv" rows={issued.map((account) => ({ username: account.username ?? "", name: account.display_name, password: account.password }))} />}

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-surface)] border border-dashed border-line-strong px-6 py-16 text-center">
          <span aria-hidden className="grid size-11 place-items-center rounded-full bg-hover text-ink-subtle"><UserRoundX className="size-5" strokeWidth={1.75} /></span>
          {rows.length === 0 ? (
            <>
              <p className="text-[15px] font-medium text-ink">No students yet</p>
              <p className="max-w-sm text-sm text-ink-muted">Import a spreadsheet of roll numbers and names, or enrol one student. Each gets a username and a one-time password.</p>
              <div className="flex flex-wrap justify-center gap-2">{actions}</div>
            </>
          ) : (
            <>
              <p className="text-[15px] font-medium text-ink">No student matches</p>
              <p className="max-w-sm text-sm text-ink-muted">Try another batch, or clear the filters and search.</p>
              <Button variant="secondary" size="sm" onClick={() => { clearFilters(); setQuery(""); setDebounced(""); }}>Clear filters</Button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-muted">
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={allOnPage}
                onChange={() => setSelected((current) => { const next = new Set(current); for (const id of pageIds) { if (allOnPage) next.delete(id); else next.add(id); } return next; })}
                className="size-4 accent-[var(--brand)]"
              />
              Select the {pageIds.length} on this page
            </label>
            {shown.length > pageIds.length && (
              <button type="button" onClick={() => setSelected(new Set(shown.map((row) => row.id)))} className="text-brand hover:underline">
                Select all {shown.length}{onlyBatch ? ` in ${onlyBatch}` : " matching the filters"}
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

      {selected.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div role="region" aria-label="Selected students" className="pointer-events-auto flex max-w-full animate-enter flex-wrap items-center gap-2 rounded-[var(--radius-surface)] border border-line-strong bg-surface/95 px-4 py-2.5 shadow-[var(--shadow-overlay)] backdrop-blur-md">
            <span className="mr-2 font-mono text-[13px] tabular-nums text-ink">
              {selected.size} selected
              {hiddenSelected > 0 && <span className="ml-1 text-ink-muted">({hiddenSelected} outside the filters)</span>}
            </span>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => run(() => bulkSetStatus(targets(), "active"))}>Enable</Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => run(() => bulkSetStatus(targets(), "disabled"))}>Disable</Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirmReset(true)}>
              {busy ? <LoaderCircle className="animate-spin" /> : <KeyRound />}
              Reset passwords
            </Button>
            <Button variant="ghost" size="icon" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
              <X />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent title={`Reset ${chosen.length} password${chosen.length === 1 ? "" : "s"}?`} description="Each student gets a new one-time password. Their current passwords stop working and they are signed out." className="w-[min(92vw,460px)]">
          <div className="flex justify-end gap-2 p-6">
            <DialogClose asChild>
              <Button type="button" variant="ghost">Cancel</Button>
            </DialogClose>
            <Button type="button" onClick={() => { setConfirmReset(false); run(() => bulkResetPasswords(targets())); }}>
              <KeyRound />
              Reset passwords
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
