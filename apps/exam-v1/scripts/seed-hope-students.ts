/**
 * Bulk-import HOPE programming training students from the attendance Excel files.
 * Students are inserted with username = reg number, batch = sheet batch label.
 * Passwords are randomly generated and written to a CSV alongside this script.
 *
 * Usage:
 *   cd apps/exam-v1
 *   pnpm tsx scripts/seed-hope-students.ts \
 *     ../../"III Year -HOPE  Programming Training Attendance.xlsx" \
 *     ../../"II Year - HOPE Programming Training Attendance.xlsx"
 *
 * Output: scripts/hope-students-passwords.csv
 */

import { createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "../lib/db.ts";
import { generatePassword, hashPassword } from "../lib/password.ts";

// ---------------------------------------------------------------------------
// Excel parsing (no external deps — use the built-in xlsx via openpyxl via
// a helper child process)  — actually we bundle the data as JSON via a
// pre-processing step.  Since this repo uses pnpm we can import xlsx via
// a lightweight helper.
// ---------------------------------------------------------------------------

import XLSX from "xlsx";

interface Student {
  reg: string;
  name: string;
  batch: string;
}

function parseXlsx(filePath: string, year: 2 | 3): Student[] {
  const workbook = XLSX.readFile(filePath);
  const students: Student[] = [];

  for (const sheetName of workbook.SheetNames as string[]) {
    const ws = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: null,
    });

    const batch = inferBatch(sheetName, year);

    for (const row of rows) {
      const sno = row[0];
      const reg = row[1];
      const name = row[2];

      if (typeof sno !== "number" || !Number.isInteger(sno)) continue;
      if (reg == null) continue;

      const regStr = String(Math.round(Number(reg)));
      const nameStr = typeof name === "string" ? name.trim() : "";
      if (!regStr || !nameStr) continue;

      students.push({ reg: regStr, name: nameStr, batch });
    }
  }

  return students;
}


function inferBatch(sheetName: string, year: 2 | 3): string {
  const s = sheetName.toLowerCase();
  if (/non.?elite/.test(s)) {
    const m = sheetName.match(/(\d+)/);
    return `${year}Y-HOPE-B${m ? m[1] : "X"}`;
  }
  if (s.includes("elite")) return `${year}Y-HOPE-ELITE`;
  const m = sheetName.match(/(\d+)/);
  return `${year}Y-HOPE-B${m ? m[1] : "X"}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const [, , ...args] = process.argv;
if (args.length < 2) {
  console.error(
    "usage: pnpm tsx scripts/seed-hope-students.ts <iii-year.xlsx> <ii-year.xlsx>",
  );
  process.exit(1);
}

const [iiiBatch, iiBatch] = args;

console.log("Parsing spreadsheets…");
const yr3 = parseXlsx(iiiBatch, 3);
const yr2 = parseXlsx(iiBatch, 2);
const all: Student[] = [...yr3, ...yr2];

const batchCounts: Record<string, number> = {};
for (const s of all) batchCounts[s.batch] = (batchCounts[s.batch] ?? 0) + 1;

console.log(`Found ${all.length} students across ${Object.keys(batchCounts).length} batches:`);
for (const [b, c] of Object.entries(batchCounts).sort()) {
  console.log(`  ${b}: ${c}`);
}

const __dir = dirname(fileURLToPath(import.meta.url));
const csvPath = join(__dir, "hope-students-passwords.csv");
const csvStream = createWriteStream(csvPath);
csvStream.write("reg_no,name,batch,password\n");

let inserted = 0;
let skipped = 0;

for (const student of all) {
  const password = generatePassword(10);
  const hash = await hashPassword(password);

  const result = await sql`
    INSERT INTO users (username, name, role, batch, password_hash)
    VALUES (${student.reg}, ${student.name}, 'student', ${student.batch}, ${hash})
    ON CONFLICT (username) DO UPDATE
      SET name = EXCLUDED.name,
          batch = EXCLUDED.batch,
          disabled = false
    RETURNING (xmax = 0) AS was_inserted
  `;

  const wasInserted = (result[0] as any).was_inserted;
  if (wasInserted) {
    inserted++;
  } else {
    // Row already existed — still update password so the CSV is always fresh
    await sql`UPDATE users SET password_hash = ${hash} WHERE username = ${student.reg}`;
    skipped++;
  }

  csvStream.write(
    `${student.reg},${JSON.stringify(student.name)},${student.batch},${password}\n`,
  );
}

csvStream.end();

console.log(`\nDone.`);
console.log(`  Inserted: ${inserted}`);
console.log(`  Updated:  ${skipped}`);
console.log(`\nPasswords written to: ${csvPath}`);

await sql.end();
