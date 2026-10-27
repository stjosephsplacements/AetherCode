"use client";

import { Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";

type ExcelJSWorksheet = {
  addRow(values: string[]): void;
  getRow(index: number): { font: { bold: boolean } };
};

type ExcelJSRuntime = {
  Workbook: new () => {
    addWorksheet(name: string): ExcelJSWorksheet;
    xlsx: { writeBuffer(): Promise<BlobPart> };
  };
};

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
      if (!(window as Window & { ExcelJS?: ExcelJSRuntime }).ExcelJS) {
        const script = document.createElement("script");
        script.src = "/monaco/vendor/exceljs.min.js";
        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("ExcelJS failed to load"));
          document.head.appendChild(script);
        });
      }
      const ExcelJS = (window as Window & { ExcelJS?: ExcelJSRuntime }).ExcelJS;
      if (!ExcelJS) throw new Error("ExcelJS failed to load");
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Exam Results");
      const firstRow = rows[0];
      if (firstRow) {
        worksheet.addRow(firstRow);
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true };
        for (const row of rows.slice(1)) {
          worksheet.addRow(row);
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
