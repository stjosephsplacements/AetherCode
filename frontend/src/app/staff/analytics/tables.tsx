"use client";

import { useState } from "react";
import { CollegeLink } from "@/components/college-link";
import { EmptyState, Table } from "@/components/staff/page-header";
import { LocalPager } from "@/components/staff/pager";
import { type ExamPoint, passes, percent } from "@/lib/analytics";
import { collegeHref } from "@/lib/links";
import { paginate } from "@/lib/paginate";
import { cn, formatDateTime } from "@/lib/utils";
import type { Rank } from "./view";

export function RankTable({ rows }: { rows: Rank[] }) {
  const [page, setPage] = useState(1);
  const paged = paginate(rows, page);
  return rows.length === 0 ? (
    <EmptyState>No graded attempts yet.</EmptyState>
  ) : (
    <>
    <Table head={["Name", "Students", "Attempts", "Average", "Pass rate"]}>
      {paged.rows.map((row) => (
        <tr key={row.id} className="border-t border-line">
          <td className="px-4 py-2.5 font-medium text-ink">{row.name}</td>
          <td className="px-4 py-2.5 tabular-nums">{row.students}</td>
          <td className="px-4 py-2.5 tabular-nums">{row.attempts}</td>
          <td className={cn("px-4 py-2.5 tabular-nums", !passes(row.average) && "text-danger")}>{percent(row.average)}</td>
          <td className="px-4 py-2.5 tabular-nums">{percent(row.pass)}</td>
        </tr>
      ))}
    </Table>
    <LocalPager meta={paged} onPage={setPage} noun="rows" />
    </>
  );
}

export function ExamTable({ points, several }: { points: ExamPoint[]; several: boolean }) {
  const [page, setPage] = useState(1);
  const paged = paginate(points, page);
  return (
    <>
    <Table head={several ? ["Exam", "College", "Opened", "Graded", "Average", "Highest", "Lowest", "Pass rate"] : ["Exam", "Opened", "Graded", "Average", "Highest", "Lowest", "Pass rate"]}>
      {paged.rows.map((point) => (
        <tr key={point.id} className="border-t border-line">
          <td className="px-4 py-2.5">
            <CollegeLink href={collegeHref(`/staff/exams/${point.id}/results`, point.college?.id)} className="font-medium text-ink hover:text-brand">
              {point.title}
            </CollegeLink>
          </td>
          {several && <td className="px-4 py-2.5 text-ink-muted">{point.college?.name}</td>}
          <td className="whitespace-nowrap px-4 py-2.5 text-ink-muted">{formatDateTime(point.at)}</td>
          <td className="px-4 py-2.5 tabular-nums">{point.graded}</td>
          <td className={cn("px-4 py-2.5 tabular-nums", !passes(point.average) && "text-danger")}>{percent(point.average)}</td>
          <td className="px-4 py-2.5 tabular-nums">{percent(point.highest)}</td>
          <td className="px-4 py-2.5 tabular-nums">{percent(point.lowest)}</td>
          <td className="px-4 py-2.5 tabular-nums">{percent(point.pass)}</td>
        </tr>
      ))}
    </Table>
    <LocalPager meta={paged} onPage={setPage} noun="exams" />
    </>
  );
}
