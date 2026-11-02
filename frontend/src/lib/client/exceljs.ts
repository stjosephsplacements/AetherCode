/** The few parts of ExcelJS the console uses; the library itself is served from /monaco/vendor. */
export type ExcelCell = null | undefined | string | number | boolean | { text?: unknown; result?: unknown };
export type ExcelRow = { values: unknown };
export type ExcelWorkbook = {
  xlsx: { load(buffer: ArrayBuffer): Promise<unknown> };
  worksheets: { eachRow(callback: (row: ExcelRow) => void): void }[];
};
type ExcelNamespace = { Workbook: new () => ExcelWorkbook };

/** Loads ExcelJS on first use and returns a new workbook. */
export async function newWorkbook(): Promise<ExcelWorkbook> {
  const host = window as unknown as { ExcelJS?: ExcelNamespace };
  if (!host.ExcelJS) {
    const script = document.createElement("script");
    script.src = "/monaco/vendor/exceljs.min.js";
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  return new host.ExcelJS!.Workbook();
}
