"use client";

import { ArrowDown, ArrowUp, Building2, Download, Search, UserCheck, UserRoundSearch, Users, X } from "lucide-react";
import Link from "next/link";
import { Popover } from "radix-ui";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Select } from "@/components/staff/form";
import { EmptyState, Section, Table } from "@/components/staff/page-header";
import { LocalPager } from "@/components/staff/pager";
import { Button } from "@/components/ui/button";
import { Badge, Panel } from "@/components/ui/card";
import { paginate } from "@/lib/paginate";
import { cn } from "@/lib/utils";
import { type CandidateRow, type DepartmentSort, type OrgRow, departmentStats, lettermark, orgStats, percent, sortDepartments } from "./stats";

type Option = { id: string; label: string };

// Quotes a CSV field and neutralizes spreadsheet formula prefixes (=, +, -, @).
const csvCell = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;

function download(filename: string, lines: string[][]) {
  const url = URL.createObjectURL(new Blob([lines.map((line) => line.map(csvCell).join(",")).join("\n")], { type: "text/csv" }));
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}
const today = () => new Date().toISOString().slice(0, 10);

/** The placements console: filters on top drive every number and list below. */
export function PlacementsBoard({
  rows,
  orgs,
  readable,
  batches,
  departments,
  several,
  truncated,
}: {
  rows: CandidateRow[];
  orgs: OrgRow[];
  readable: boolean;
  batches: Option[];
  departments: Option[];
  several: boolean;
  truncated: boolean;
}) {
  const [batch, setBatch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<DepartmentSort>("percent");
  const [descending, setDescending] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => { setDebounced(query); setPage(1); }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const needle = debounced.trim().toLowerCase();
  const shown = useMemo(
    () =>
      rows.filter(
        (row) =>
          (!batch || row.batchId === batch) &&
          (picked.size === 0 || picked.has(row.departmentId)) &&
          (!needle || row.roll.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle)),
      ),
    [rows, batch, picked, needle],
  );
  const trackName = useMemo(() => new Map(orgs.flatMap((org) => org.tracks.map((track) => [track.id, `${track.label}, ${org.name}`] as const))), [orgs]);
  const assigned = shown.filter((row) => row.placementId).length;
  const departmentRows = useMemo(() => sortDepartments(departmentStats(shown), sort, descending), [shown, sort, descending]);
  const perOrg = useMemo(() => orgStats(shown, orgs), [shown, orgs]);
  const paged = paginate(shown, page);

  const filterCount = (batch ? 1 : 0) + picked.size + (needle ? 1 : 0);
  const clear = () => { setBatch(""); setPicked(new Set()); setQuery(""); setDebounced(""); setPage(1); };
  const togglePicked = (id: string) => {
    setPicked((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
    setPage(1);
  };
  const sortBy = (key: DepartmentSort) => {
    if (key === sort) setDescending((current) => !current);
    else { setSort(key); setDescending(key !== "label"); }
  };

  const kpi = (label: string, value: number | string, note: string, icon: ReactNode) => (
    <div className="rounded-[var(--radius-surface)] border border-line bg-surface p-5">
      <div className="flex items-center justify-between text-ink-muted">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em]">{label}</span>
        <span aria-hidden className="text-brand">{icon}</span>
      </div>
      <p className="mt-3 font-mono text-[28px] font-semibold leading-none tabular-nums tracking-tight text-ink">{value}</p>
      <p className="mt-2 text-xs text-ink-muted">{note}</p>
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Summary">
        {kpi("Placement organisations", orgs.length, `${orgs.reduce((sum, org) => sum + org.tracks.length, 0)} placement departments`, <Building2 className="size-4" />)}
        {kpi("Students", shown.length, shown.length === rows.length ? "in the colleges you can see" : `of ${rows.length} in view`, <Users className="size-4" />)}
        {kpi("In a placement department", `${assigned}`, `${percent(assigned, shown.length)}% of the students shown`, <UserCheck className="size-4" />)}
        {kpi("Not yet assigned", shown.length - assigned, "waiting for a placement department", <UserRoundSearch className="size-4" />)}
      </div>

      <div className="sticky top-0 z-20 -mx-1 space-y-2 bg-canvas/90 px-1 py-2 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1 sm:max-w-xs">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" strokeWidth={1.75} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search roll number or name"
              aria-label="Search students"
              className="h-8 w-full rounded-full border border-line-strong bg-surface pl-9 pr-3 text-[13px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15"
            />
          </div>
          <Select aria-label="Batch" size="sm" className="w-52" value={batch} onValueChange={(value) => { setBatch(value); setPage(1); }}>
            <option value="">All batches</option>
            {batches.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </Select>
          {filterCount > 0 && (
            <button type="button" onClick={clear} className="text-[13px] text-brand hover:underline">
              Clear all ({filterCount})
            </button>
          )}
        </div>
        {departments.length > 0 && (
          <div role="group" aria-label="Departments" className="-mb-1 flex gap-1.5 overflow-x-auto pb-1">
            {departments.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={picked.has(entry.id)}
                onClick={() => togglePicked(entry.id)}
                className={cn(
                  "h-7 shrink-0 rounded-full border px-3 text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/15",
                  picked.has(entry.id) ? "border-brand bg-brand-soft text-brand-soft-ink" : "border-line-strong bg-surface text-ink-muted hover:text-ink",
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
        )}
        {filterCount > 0 && (
          <ul aria-label="Active filters" className="flex flex-wrap gap-1.5">
            {batch && <Chip label={batches.find((entry) => entry.id === batch)?.label ?? "Batch"} onRemove={() => setBatch("")} />}
            {[...picked].map((id) => <Chip key={id} label={departments.find((entry) => entry.id === id)?.label ?? "Department"} onRemove={() => togglePicked(id)} />)}
            {needle && <Chip label={`"${debounced.trim()}"`} onRemove={() => { setQuery(""); setDebounced(""); }} />}
          </ul>
        )}
      </div>

      <Section title="Placement organisations" description="Each organisation's placement departments, and how many of the students in view are assigned to them.">
        {!readable ? (
          <EmptyState>Only a platform administrator can view placement organisations.</EmptyState>
        ) : orgs.length === 0 ? (
          <EmptyState>
            No placement organisations yet. Add one in{" "}
            <Link href="/staff/organisation" className="text-brand hover:underline">
              Departments
            </Link>
            .
          </EmptyState>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {perOrg.map(({ org, assigned: inOrg, perTrack }) => (
              <li key={org.id}>
                <Panel className="flex h-full flex-col gap-4 p-5">
                  <div className="flex items-start gap-3">
                    <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-soft font-mono text-sm font-semibold text-brand-soft-ink">{lettermark(org.name)}</span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[15px] font-semibold text-ink">{org.name}</h3>
                      <p className="font-mono text-[12px] text-ink-subtle">{org.code}</p>
                    </div>
                    <Badge tone={org.status === "active" ? "success" : "neutral"} className="capitalize">{org.status}</Badge>
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between text-[12.5px]">
                      <span className="text-ink-muted">Students assigned</span>
                      <span className="font-mono tabular-nums text-ink">{inOrg}<span className="text-ink-subtle"> / {shown.length}</span></span>
                    </div>
                    <Bar value={percent(inOrg, shown.length)} label={`${inOrg} of ${shown.length} students are in ${org.name}`} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {org.tracks.length === 0 && <span className="text-xs italic text-ink-muted">No placement departments yet.</span>}
                    {perTrack.slice(0, 3).map(({ track, assigned: count }) => (
                      <Badge key={track.id} tone="neutral" title={`${count} students`}>{track.label}</Badge>
                    ))}
                    {perTrack.length > 3 && (
                      <Popover.Root>
                        <Popover.Trigger className="h-6 rounded-full border border-line-strong px-2.5 text-xs font-medium text-ink-muted outline-none hover:text-ink focus-visible:ring-4 focus-visible:ring-brand/15">
                          +{perTrack.length - 3} more
                        </Popover.Trigger>
                        <Popover.Portal>
                          <Popover.Content align="start" sideOffset={6} className="z-50 max-h-72 w-64 animate-fade overflow-y-auto rounded-[var(--radius-surface)] border border-line-strong bg-surface p-2 shadow-[var(--shadow-overlay)]">
                            <ul>
                              {perTrack.map(({ track, assigned: count }) => (
                                <li key={track.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-[13px] text-ink">
                                  <span className="min-w-0 truncate">{track.label}</span>
                                  <span className="font-mono text-xs tabular-nums text-ink-muted">{count}</span>
                                </li>
                              ))}
                            </ul>
                          </Popover.Content>
                        </Popover.Portal>
                      </Popover.Root>
                    )}
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2 border-t border-line pt-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={inOrg === 0}
                      onClick={() => {
                        const own = new Set(org.tracks.map((track) => track.id));
                        download(`${org.code || "organisation"}-students-${today()}.csv`, [["Roll number", "Name", ...(several ? ["College"] : []), "Department", "Batch", "Placement department"], ...shown.filter((row) => own.has(row.placementId)).map((row) => [row.roll, row.name, ...(several ? [row.college] : []), row.department, row.batch, trackName.get(row.placementId) ?? ""])]);
                      }}
                    >
                      <Download />
                      Export students
                    </Button>
                    <Button asChild variant="ghost" size="sm">
                      <Link href="/staff/organisation">Manage departments</Link>
                    </Button>
                  </div>
                </Panel>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Department breakdown" description="How far each college department has got in assigning its students to a placement department.">
        {departmentRows.length === 0 ? (
          <EmptyState>No student matches those filters.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-surface)] border border-line bg-surface">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-sidebar">
                <tr>
                  {([["label", "Department"], ["total", "Students"], ["assigned", "Assigned"], ["pending", "Pending"], ["percent", "Coverage"]] as [DepartmentSort, string][]).map(([key, label]) => (
                    <th key={key} scope="col" aria-sort={sort === key ? (descending ? "descending" : "ascending") : "none"} className="px-4 py-2.5 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-ink-subtle">
                      <button type="button" onClick={() => sortBy(key)} className="inline-flex items-center gap-1 uppercase tracking-[0.08em] hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/15">
                        {label}
                        {sort === key && (descending ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&_tr]:transition-colors [&_tr:hover]:bg-hover [&_tr+tr]:border-t [&_tr+tr]:border-line">
                {departmentRows.map((stat) => (
                  <tr key={stat.id}>
                    <td className="px-4 py-2.5 font-medium text-ink">{stat.label}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums">{stat.total}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-success">{stat.assigned}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-ink-muted">{stat.pending}</td>
                    <td className="w-64 px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <Bar value={stat.percent} label={`${stat.label}: ${stat.percent}% assigned`} className="flex-1" />
                        <span className="w-10 text-right font-mono text-xs tabular-nums text-ink">{stat.percent}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Students"
        description="Everyone the filters above leave in view, with the placement department they are assigned to."
        actions={
          <Button
            variant="secondary"
            size="sm"
            disabled={shown.length === 0}
            onClick={() => download(`placement-candidates-${today()}.csv`, [["Roll number", "Name", ...(several ? ["College"] : []), "Department", "Batch", "Placement department", "Sign-in"], ...shown.map((row) => [row.roll, row.name, ...(several ? [row.college] : []), row.department, row.batch, trackName.get(row.placementId) ?? "", row.status])])}
          >
            <Download />
            Export {shown.length}
          </Button>
        }
      >
        {shown.length === 0 ? (
          <EmptyState>{rows.length === 0 ? "No students enrolled yet." : "No student matches those filters."}</EmptyState>
        ) : (
          <div className="space-y-3">
            <Table head={["Student", "Department", "Batch", "Placement department"]}>
              {paged.rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2.5">
                    <span className="block text-ink">{row.name || <span className="text-ink-subtle">Unnamed</span>}</span>
                    <span className="block font-mono text-[12px] text-ink-muted">{row.roll}</span>
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">{row.department || "None"}{several && <span className="block text-[11.5px] text-ink-subtle">{row.college}</span>}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-ink-muted">{row.batch}</td>
                  <td className="px-4 py-2.5">
                    {row.placementId ? <Badge tone="success">{trackName.get(row.placementId) ?? "Assigned"}</Badge> : <Badge tone="warning">Not assigned</Badge>}
                  </td>
                </tr>
              ))}
            </Table>
            <LocalPager meta={paged} onPage={setPage} noun="students" />
            {truncated && <p className="text-center text-xs text-warning">Only the first 5,000 students were loaded, so these numbers and exports are incomplete.</p>}
          </div>
        )}
      </Section>
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <li className="inline-flex h-6 items-center gap-1 rounded-full bg-brand-soft pl-2.5 pr-1 text-xs text-brand-soft-ink">
      {label}
      <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} className="grid size-4 place-items-center rounded-full hover:bg-brand/15">
        <X className="size-3" />
      </button>
    </li>
  );
}

function Bar({ value, label, className }: { value: number; label: string; className?: string }) {
  return (
    <div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label} className={cn("h-2 overflow-hidden rounded-full bg-hover", className)}>
      <div className="h-full rounded-full bg-brand transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${value}%` }} />
    </div>
  );
}
