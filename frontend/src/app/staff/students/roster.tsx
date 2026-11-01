"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { LocalPager } from "@/components/staff/pager";
import { Table } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import type { Student } from "@/lib/api-types";
import { paginate } from "@/lib/paginate";
import { cn } from "@/lib/utils";
import { StudentActions } from "./panels";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "disabled", label: "Disabled" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

/** The batch's students: search by roll number, filter by status, 25 to a page. */
export function Roster({ students, placementNames, collegeId }: { students: Student[]; placementNames: Record<string, string>; collegeId: string }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const needle = query.trim().toLowerCase();
  const shown = students.filter(
    (student) => (filter === "all" || (filter === "active" ? student.status === "active" : student.status !== "active")) && (!needle || student.enrollment_number.toLowerCase().includes(needle)),
  );
  const paged = paginate(shown, page);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" strokeWidth={1.75} />
          <input
            type="search"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(1); }}
            placeholder="Search by roll number"
            aria-label="Search students"
            className="h-9 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface pl-9 pr-3 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15"
          />
        </div>
        <div role="group" aria-label="Status" className="flex gap-1 rounded-full bg-hover p-1">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => { setFilter(key); setPage(1); }}
              className={cn("rounded-full px-3 py-1 text-[13px] transition-colors", filter === key ? "bg-surface text-ink shadow-[var(--shadow-hairline)]" : "text-ink-muted hover:text-ink")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-[var(--radius-surface)] border border-dashed border-line-strong px-6 py-12 text-center text-sm text-ink-muted">
          {students.length === 0 ? "No students in this batch yet. Use Import students." : "No student matches that."}
        </div>
      ) : (
        <Table head={["Roll number", "Placement department", "Status", ""]}>
          {paged.rows.map((student) => (
            <tr key={student.id}>
              <td className="px-4 py-2.5 font-mono text-[13px]">
                <Link href={`/staff/students/${student.id}?college=${collegeId}`} className="font-medium text-ink hover:text-brand hover:underline">
                  {student.enrollment_number}
                </Link>
              </td>
              <td className="px-4 py-2.5 text-ink-muted">{placementNames[student.placement_department_id ?? ""] ?? "Not visible to your role"}</td>
              <td className="px-4 py-2.5">
                <Badge tone={student.status === "active" ? "success" : "neutral"}>{student.status}</Badge>
              </td>
              <td className="px-4 py-2.5">
                <StudentActions principalId={student.principal_id} username={student.enrollment_number.toLowerCase()} collegeId={student.tenant_id} />
              </td>
            </tr>
          ))}
        </Table>
      )}
      <LocalPager meta={paged} onPage={setPage} noun="students" />
    </div>
  );
}
