"use client";

import type { Credential } from "@/app/admin/actions";
import { toCsv } from "@/lib/csv";
import { LoginSlips } from "./login-slips";
import { Button } from "./ui";

export function downloadCsv(fileName: string, rows: string[][]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function CredentialsTable({ credentials }: { credentials: Credential[] }) {
  return (
    <div className="mt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Passwords are shown <strong className="text-ink">only once</strong>. Download them now.
        </p>
        <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => window.print()}>
          Print login slips
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            downloadCsv("credentials.csv", [
              ["username", "name", "batch", "password"],
              ...credentials.map((row) => [row.username, row.name, row.batch ?? "", row.password]),
            ])
          }
        >
          Download CSV
        </Button>
        </div>
      </div>
      <LoginSlips credentials={credentials} />
      <div className="max-h-80 overflow-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-sunken text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Username</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Batch</th>
              <th className="px-3 py-2">Password</th>
            </tr>
          </thead>
          <tbody>
            {credentials.map((row) => (
              <tr key={row.username} className="border-t border-line">
                <td className="px-3 py-2 font-medium">{row.username}</td>
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2 text-muted">{row.batch ?? "—"}</td>
                <td className="px-3 py-2 font-mono">{row.password}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
