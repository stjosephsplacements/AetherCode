"use client";

import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export type Credential = { username: string; name?: string; password: string };

function toCsv(rows: Credential[]): string {
  // Cells starting with = + - @ would run as spreadsheet formulas.
  const cell = (value: string) => {
    const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  return ["username,name,password", ...rows.map((row) => [row.username, row.name ?? "", row.password].map(cell).join(","))].join("\n");
}

/**
 * One-time passwords, shown once: the platform never returns them again.
 * Download them as CSV or print one slip per student.
 */
export function CredentialsTable({ rows, filename }: { rows: Credential[]; filename: string }) {
  function download() {
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: filename });
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="mt-4 rounded-[var(--radius-surface)] border border-warning/40 bg-warning-soft/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-ink">
          <span className="font-semibold">Save these now.</span> Passwords are shown only once.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={download}>
            <Download />
            Download CSV
          </Button>
          <Button size="sm" variant="secondary" onClick={() => window.print()}>
            <Printer />
            Print login slips
          </Button>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 print:gap-0">
        {rows.map((row) => (
          <div
            key={row.username}
            className="break-inside-avoid rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2.5 print:rounded-none print:border-dashed"
          >
            {row.name && <p className="truncate text-sm font-medium text-ink">{row.name}</p>}
            <p className="font-mono text-xs text-ink-muted">
              Username <span className="text-ink">{row.username}</span>
            </p>
            <p className="font-mono text-xs text-ink-muted">
              Password <span className="select-all text-ink">{row.password}</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
