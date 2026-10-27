"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ExportButton({ rows, filename }: { rows: string[][]; filename: string }) {
  function download() {
    // Cells starting with = + - @ would run as spreadsheet formulas.
    const cell = (value: string) => {
      const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
      return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
    };
    const url = URL.createObjectURL(new Blob([rows.map((row) => row.map(cell).join(",")).join("\n")], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: filename }).click();
    URL.revokeObjectURL(url);
  }
  return (
    <Button variant="secondary" size="sm" onClick={download}>
      <Download />
      Export CSV
    </Button>
  );
}
