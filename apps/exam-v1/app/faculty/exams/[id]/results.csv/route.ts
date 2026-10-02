import { currentUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { attemptStatus, examResults } from "@/lib/results";

const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user || user.role === "student") return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const [exam] = await sql<{ title: string }[]>`SELECT title FROM exams WHERE id = ${id}`;
  if (!exam) return new Response("Not found", { status: 404 });
  const batch = new URL(request.url).searchParams.get("batch");
  const { questions, rows } = await examResults(id);
  const lines = [
    ["roll_no", "name", "batch", "status", ...questions.map((question, index) => `Q${index + 1} ${question.title} (/${question.points})`), "total", "focus_lost", "started_at", "finished_at"],
    ...rows
      .filter((row) => !batch || row.batch === batch)
      .map((row) => [
        row.username,
        row.name,
        row.batch ?? "",
        attemptStatus(row),
        ...questions.map((question) => String(row.scores[question.id] ?? 0)),
        String(row.total),
        String(row.focusLosses),
        row.startedAt?.toISOString() ?? "",
        (row.finishedAt ?? row.deadlineAt)?.toISOString() ?? "",
      ]),
  ];
  const fileName = `${exam.title.replace(/[^A-Za-z0-9]+/g, "-")}${batch ? `-${batch}` : ""}-results.csv`;
  return new Response("﻿" + lines.map((line) => line.map(escape).join(",")).join("\r\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${fileName}"` },
  });
}
