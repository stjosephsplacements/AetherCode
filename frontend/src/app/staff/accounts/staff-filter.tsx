"use client";

import { Download, Search, UserCheck, Users, ShieldAlert, GraduationCap, Briefcase } from "lucide-react";
import { type ReactNode, useDeferredValue, useMemo, useState } from "react";
import { Badge, Panel } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/staff/form";
import { EmptyState, Table } from "@/components/staff/page-header";
import { Pager } from "@/components/staff/pager";
import { paginate } from "@/lib/paginate";
import { StudentActions } from "../students/panels";
import { lettermark } from "../placements/stats";
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
  batches: { id: string; name: string }[];
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
        .join(",")
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

  // Summary counts
  const totalCount = staffRows.length;
  const facultyCount = staffRows.filter((row) => row.roleTypes.includes("department_user")).length;
  const adminCount = staffRows.filter((row) => row.roleTypes.includes("college_admin")).length;
  const mentorCount = staffRows.filter((row) => row.roleTypes.includes("mentor")).length;
  const placementCount = staffRows.filter((row) => row.roleTypes.includes("placement_user")).length;

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return staffRows.filter((row) => {
      if (roleFilter !== "all" && !row.roleTypes.includes(roleFilter)) {
        return false;
      }
      if (statusFilter !== "all" && row.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        row.displayName.toLowerCase().includes(q) ||
        row.username.toLowerCase().includes(q) ||
        (row.email && row.email.toLowerCase().includes(q)) ||
        row.roles.some((r) => r.label.toLowerCase().includes(q))
      );
    });
  }, [staffRows, deferredQuery, roleFilter, statusFilter]);

  const paged = paginate(filtered, currentPage);

  function exportFiltered() {
    const header = [
      "Name",
      "Username",
      "Email",
      "Status",
      ...(severalColleges ? ["College"] : []),
      "Roles",
    ];
    const data = filtered.map((row) => [
      row.displayName,
      row.username,
      row.email ?? "",
      row.status,
      ...(severalColleges ? [row.collegeName] : []),
      row.roles.map((r) => r.label).join("; "),
    ]);
    downloadCsv(`staff-export-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...data]);
  }

  const hasActiveFilters = Boolean(query.trim() || roleFilter !== "all" || statusFilter !== "all");

  const clearAllFilters = () => {
    setQuery("");
    setRoleFilter("all");
    setStatusFilter("all");
  };

  const kpi = (label: string, value: number | string, icon: ReactNode) => (
    <div className="min-w-0 rounded-[var(--radius-surface)] border border-line bg-surface p-4 shadow-[var(--shadow-hairline)]">
      <div className="flex items-center justify-between gap-2 text-ink-muted">
        <span className="truncate font-mono text-[11px] uppercase tracking-[0.08em]">{label}</span>
        <span aria-hidden className="shrink-0 text-brand">{icon}</span>
      </div>
      <p className="mt-2.5 font-mono text-[26px] font-semibold leading-none tabular-nums tracking-tight text-ink">{value}</p>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <section aria-label="Staff Metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpi("Total Staff", totalCount, <Users className="size-4" />)}
        {kpi("Faculty", facultyCount, <GraduationCap className="size-4" />)}
        {kpi("Mentors", mentorCount, <UserCheck className="size-4" />)}
        {kpi("Placement", placementCount, <Briefcase className="size-4" />)}
        {kpi("Admins", adminCount, <ShieldAlert className="size-4" />)}
      </section>

      {/* Filter and Control Bar */}
      <Panel className="p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1 sm:min-w-[260px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, username, or role..."
              className="h-8 w-full rounded-[var(--radius-control)] border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Filter by role"
              size="sm"
              className="w-44"
              value={roleFilter}
              onValueChange={setRoleFilter}
            >
              <option value="all">All Roles</option>
              <option value="department_user">Faculty</option>
              <option value="mentor">Mentor</option>
              <option value="placement_user">Placement Officer</option>
              <option value="college_admin">College Admin</option>
            </Select>

            <Select
              aria-label="Filter by status"
              size="sm"
              className="w-36"
              value={statusFilter}
              onValueChange={setStatusFilter}
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </Select>

            <Button
              variant="secondary"
              size="sm"
              onClick={exportFiltered}
              disabled={filtered.length === 0}
              title="Export visible staff to CSV"
            >
              <Download className="size-3.5" />
              Export
            </Button>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="text-xs font-medium text-brand hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {hasActiveFilters && (
          <div className="mt-2.5 flex items-center justify-between border-t border-line/60 pt-2 text-xs text-ink-muted">
            <span>
              Showing <span className="font-mono font-medium text-ink">{filtered.length}</span> of{" "}
              <span className="font-mono text-ink">{totalCount}</span> staff accounts
            </span>
          </div>
        )}
      </Panel>

      {/* Staff Table */}
      <section aria-label="Staff directory" className="space-y-3">
        {filtered.length === 0 ? (
          <EmptyState>
            {hasActiveFilters ? "No staff accounts match your current filters." : "No staff accounts yet."}
          </EmptyState>
        ) : (
          <>
            <Table head={severalColleges ? ["Staff Member", "College", "Roles & Scope", ""] : ["Staff Member", "Roles & Scope", ""]}>
              {paged.rows.map((row) => (
                <tr key={`${row.collegeId}-${row.principalId}`} className="border-t border-line align-top transition-colors hover:bg-hover/30">
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-soft font-mono text-[13px] font-semibold text-brand-soft-ink"
                      >
                        {lettermark(row.displayName)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-ink truncate max-w-[200px] sm:max-w-none" title={row.displayName}>
                            {row.displayName}
                          </span>
                          <Badge tone={row.status === "active" ? "success" : "danger"} className="text-[11px]">
                            {row.status === "active" ? "Can sign in" : "Sign-in disabled"}
                          </Badge>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-muted">
                          <span className="font-mono text-ink-subtle">@{row.username}</span>
                          {row.email && (
                            <>
                              <span className="text-ink-subtle/50">•</span>
                              <span className="truncate max-w-[220px]" title={row.email}>
                                {row.email}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>

                  {severalColleges && (
                    <td className="px-4 py-3 text-sm text-ink-muted">
                      {row.collegeName}
                    </td>
                  )}

                  <td className="px-4 py-3">
                    <RoleEditor
                      collegeId={row.collegeId}
                      principalId={row.principalId}
                      roles={row.roles}
                      departments={row.departments}
                      batches={row.batches}
                      placements={placementList}
                    />
                  </td>

                  <td className="px-4 py-3 text-right">
                    <StudentActions
                      principalId={row.principalId}
                      username={row.username}
                      collegeId={row.collegeId}
                      status={row.status}
                    />
                  </td>
                </tr>
              ))}
            </Table>
            <Pager meta={paged} noun="staff" />
          </>
        )}
      </section>
    </div>
  );
}
