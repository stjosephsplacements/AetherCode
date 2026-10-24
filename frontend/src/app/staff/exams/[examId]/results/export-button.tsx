"use client";

import { Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ExportButton({ rows, filename }: { rows: string[][]; filename: string }) {
  function downloadCsv() {
    const cell = (value: string) => {
      const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
      return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
    };
    const url = URL.createObjectURL(new Blob([rows.map((row) => row.map(cell).join(",")).join("\n")], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: filename.endsWith(".csv") ? filename : `${filename}.csv` }).click();
    URL.revokeObjectURL(url);
  }

  async function downloadExcel() {
    try {
      if (!(window as any).ExcelJS) {
        const script = document.createElement("script");
        script.src = "/monaco/vendor/exceljs.min.js";
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }
      const workbook = new (window as any).ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Exam Results");
      if (rows.length > 0) {
        worksheet.addRow(rows[0]);
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true };
        for (let i = 1; i < rows.length; i++) {
          worksheet.addRow(rows[i]);
        }
      }
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const xlsxName = filename.replace(/\.csv$/, "") + ".xlsx";
      Object.assign(document.createElement("a"), { href: url, download: xlsxName }).click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("ExcelJS export failed, falling back to CSV", err);
      downloadCsv();
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={downloadCsv} className="gap-1.5">
        <Download className="size-3.5" />
        CSV
      </Button>
      <Button size="sm" onClick={downloadExcel} className="gap-1.5">
        <FileSpreadsheet className="size-3.5" />
        Export Excel (.xlsx)
      </Button>
    </div>
  );
}
