"use client";

import { DownloadSimple, MagnifyingGlass } from "@phosphor-icons/react/ssr";
import { useDeferredValue, useMemo, useState } from "react";
import { FigureCard } from "@/app/admin/_dashboard/charts";
import { panel } from "@/app/admin/_dashboard/panel";
import { Select } from "@/components/staff/form";
import { EmptyState } from "@/components/staff/page-header";
import { Pager } from "@/components/staff/pager";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { lettermark } from "@/lib/lettermark";
import { paginate } from "@/lib/paginate";
import { cn } from "@/lib/utils";
import { StudentActions } from "../students/panels";
import { RoleEditor, type RoleChip } from "./roles";

export type StaffRow = {
  collegeId: string;
  collegeName: string;
  principalId: string;
  displayName: string;
  username: string;
  email?: string;
  status: string;
  roles: RoleChip[];
  roleTypes: string[];
  departments: { id: string; name: string }[];
  batches: { id: string; name: string; departmentId: string }[];
};

type PlacementOption = { id: string; name: string };

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const content = rows
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell ?? "").replace(/"/g, '""');
          return `"${text}"`;
        })
        .join(","),
    )
    .join("\r\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function StaffFilter({
  staffRows,
  placementList,
  severalColleges,
  currentPage,
}: {
  staffRows: StaffRow[];
  placementList: PlacementOption[];
  severalColleges: boolean;
  currentPage?: string;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const totalCount = staffRows.length;
  const facultyCount = staffRows.filter((row) => row.roleTypes.includes("department_user")).length;
  const adminCount = staffRows.filter((row) => row.roleTypes.includes("college_admin")).length;
  const mentorCount = staffRows.filter((row) => row.roleTypes.includes("mentor")).length;
  const placementCount = staffRows.filter((row) => row.roleTypes.includes("placement_user")).length;
  const disabledCount = staffRows.filter((row) => row.status !== "active").length;

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return staffRows.filter((row) => {
      if (roleFilter !== "all" && !row.roleTypes.includes(roleFilter)) return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!q) return true;
      return (
        row.displayName.toLowerCase().includes(q) ||
        row.username.toLowerCase().includes(q) ||
        (row.email && row.email.toLowerCase().includes(q)) ||
        row.roles.some((role) => role.label.toLowerCase().includes(q))
      );
    });
  }, [staffRows, deferredQuery, roleFilter, statusFilter]);

  const paged = paginate(filtered, currentPage);
  const hasActiveFilters = Boolean(query.trim() || roleFilter !== "all" || statusFilter !== "all");

  function exportFiltered() {
    const header = ["Name", "Username", "Email", "Status", ...(severalColleges ? ["College"] : []), "Roles"];
    const data = filtered.map((row) => [
      row.displayName,
      row.username,
      row.email ?? "",
      row.status,
      ...(severalColleges ? [row.collegeName] : []),
      row.roles.map((role) => role.label).join("; "),
    ]);
    downloadCsv(`staff-export-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...data]);
  }

  const clearAllFilters = () => {
    setQuery("");
    setRoleFilter("all");
    setStatusFilter("all");
  };

  return (
    <div className="grid auto-rows-[minmax(120px,auto)] gap-3 md:grid-cols-6 xl:grid-cols-12">
      <FigureCard label="Staff" value={String(totalCount)} note="accounts in this college" className="md:col-span-2 xl:col-span-2" />
      <FigureCard label="Faculty" value={String(facultyCount)} note="department roles" className="md:col-span-2 xl:col-span-2" />
      <FigureCard label="Mentors" value={String(mentorCount)} note="batch mentors" className="md:col-span-2 xl:col-span-2" />
      <FigureCard label="Placement" value={String(placementCount)} note="placement officers" className="md:col-span-2 xl:col-span-2" />
      <FigureCard label="Admins" value={String(adminCount)} note="college administrators" className="md:col-span-2 xl:col-span-2" />
      <FigureCard
        label="Disabled"
        value={String(disabledCount)}
        note="cannot sign in"
        tone={disabledCount ? "warn" : "good"}
        className="md:col-span-2 xl:col-span-2"
      />

      <section className={cn(panel, "md:col-span-6 xl:col-span-12")}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Directory</h2>
            <p className="mt-1 text-[12.5px] text-ink-muted">Search, filter and export staff. Roles control what each person can do.</p>
          </div>
          <p className="font-mono text-[12.5px] tabular-nums text-ink-muted">
            {filtered.length}
            <span className="text-ink-subtle"> / {totalCount}</span>
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:min-w-[260px]">
            <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, username, or role…"
              aria-label="Search staff"
              className="h-9 w-full rounded-control border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </div>
          <Select aria-label="Filter by role" size="sm" className="w-44" value={roleFilter} onValueChange={setRoleFilter}>
            <option value="all">All roles</option>
            <option value="department_user">Faculty</option>
            <option value="mentor">Mentor</option>
            <option value="placement_user">Placement officer</option>
            <option value="college_admin">College admin</option>
          </Select>
          <Select aria-label="Filter by status" size="sm" className="w-36" value={statusFilter} onValueChange={setStatusFilter}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </Select>
          <Button variant="secondary" size="sm" onClick={exportFiltered} disabled={filtered.length === 0} title="Export visible staff to CSV">
            <DownloadSimple className="size-3.5" />
            Export
          </Button>
          {hasActiveFilters && (
            <button type="button" onClick={clearAllFilters} className="text-[12.5px] font-medium text-brand hover:underline">
              Clear filters
            </button>
          )}
        </div>
      </section>

      <section aria-label="Staff directory" className={cn(panel, "md:col-span-6 xl:col-span-12")}>
        {filtered.length === 0 ? (
          <EmptyState>
            {hasActiveFilters ? (
              <>
                <p className="mb-2 text-[15px] font-medium text-ink">No matches</p>
                Nothing matches the current filters.
              </>
            ) : (
              <>
                <p className="mb-2 text-[15px] font-medium text-ink">No staff yet</p>
                Create or import a staff account to get started.
              </>
            )}
          </EmptyState>
        ) : (
          <>
            <ul className="space-y-2">
              {paged.rows.map((row) => (
                <li
                  key={`${row.collegeId}-${row.principalId}`}
                  className="rounded-control border border-line bg-hover/30 px-3.5 py-3 transition-colors hover:bg-hover"
                >
                  <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
                    <span
                      aria-hidden
                      className="grid size-10 shrink-0 place-items-center rounded-control bg-brand-soft font-mono text-[13px] font-semibold text-brand-soft-ink"
                    >
                      {lettermark(row.displayName)}
                    </span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[14.5px] font-semibold text-ink" title={row.displayName}>
                          {row.displayName}
                        </span>
                        <Badge tone={row.status === "active" ? "success" : "danger"}>
                          {row.status === "active" ? "Can sign in" : "Sign-in disabled"}
                        </Badge>
                        {severalColleges && <span className="text-[12px] text-ink-subtle">{row.collegeName}</span>}
                      </div>
                      <p className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-muted">
                        <span className="font-mono text-ink-subtle">@{row.username}</span>
                        {row.email && (
                          <>
                            <span className="text-ink-subtle/50">·</span>
                            <span className="truncate" title={row.email}>
                              {row.email}
                            </span>
                          </>
                        )}
                      </p>
                      <RoleEditor
                        collegeId={row.collegeId}
                        principalId={row.principalId}
                        roles={row.roles}
                        departments={row.departments}
                        batches={row.batches}
                        placements={placementList}
                      />
                    </div>
                    <div className="ml-auto shrink-0">
                      <StudentActions principalId={row.principalId} username={row.username} collegeId={row.collegeId} status={row.status} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <Pager meta={paged} noun="staff" />
          </>
        )}
      </section>
    </div>
  );
}
