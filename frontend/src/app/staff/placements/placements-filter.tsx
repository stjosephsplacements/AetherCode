"use client";

import { useState } from "react";
import { Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table } from "@/components/staff/page-header";
import type { Department, Student } from "@/lib/api-types";

export function PlacementsFilter({
  students,
  departments,
}: {
  students: Student[];
  departments: Department[];
}) {
  const [selectedDept, setSelectedDept] = useState<string>("all");
  const [search, setSearch] = useState<string>("");

  const deptMap = new Map(departments.map((d) => [d.id, d.name]));

  const filtered = students.filter((student) => {
    const matchesDept = selectedDept === "all" || student.college_department_id === selectedDept;
    const matchesSearch =
      !search ||
      student.enrollment_number.toLowerCase().includes(search.toLowerCase()) ||
      student.principal_id.toLowerCase().includes(search.toLowerCase());
    return matchesDept && matchesSearch;
  });

  function exportList() {
    const csvContent =
      "data:text/csv;charset=utf-8," +
      ["Roll Number,Department,Status"].concat(
        filtered.map((s) => `${s.enrollment_number},"${deptMap.get(s.college_department_id || "") || "General"}",${s.status}`)
      ).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `placement_candidates_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="flex flex-1 items-center gap-3 w-full">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 size-4 text-ink-muted" />
            <input
              type="text"
              placeholder="Search by roll number or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface pl-9 pr-3 text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <select
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand"
          >
            <option value="all">All Departments ({departments.length})</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name} ({dept.code})
              </option>
            ))}
          </select>
        </div>
        <Button variant="secondary" size="sm" onClick={exportList} className="gap-1.5 shrink-0">
          <Download className="size-3.5" />
          Export Candidates ({filtered.length})
        </Button>
      </div>

      <Table head={["Roll Number", "Department", "Placement Status"]}>
        {filtered.slice(0, 25).map((student) => (
          <tr key={student.id} className="border-t border-line text-xs">
            <td className="px-4 py-2.5 font-mono font-medium text-ink">{student.enrollment_number}</td>
            <td className="px-4 py-2.5 text-ink-muted">{deptMap.get(student.college_department_id || "") || "General Engineering"}</td>
            <td className="px-4 py-2.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success capitalize">
                {student.status}
              </span>
            </td>
          </tr>
        ))}
      </Table>
      {filtered.length > 25 && (
        <p className="text-center text-xs text-ink-muted">Showing first 25 of {filtered.length} matching candidates. Use Export for complete dataset.</p>
      )}
    </div>
  );
}
