"use client";

import Papa from "papaparse";
import { useState, useTransition } from "react";
import { importStudents, type ImportResult } from "./actions";
import { CredentialsTable } from "@/components/credentials";
import { Card } from "@/components/ui";

const HEADER_ALIASES: Record<string, string> = {
  username: "username",
  roll_no: "username",
  rollno: "username",
  roll_number: "username",
  roll: "username",
  register_no: "username",
  name: "name",
  student_name: "name",
  full_name: "name",
  batch: "batch",
  section: "batch",
  class: "batch",
};

export function ImportStudents() {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onFile(file: File) {
    setResult(null);
    setParseError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => HEADER_ALIASES[header.trim().toLowerCase().replace(/[\s.]+/g, "_")] ?? header.trim(),
      complete: (parsed) => {
        const fields = parsed.meta.fields ?? [];
        const missing = ["username", "name", "batch"].filter((field) => !fields.includes(field));
        if (missing.length > 0) {
          setParseError(`CSV is missing column(s): ${missing.join(", ")}. Expected: roll_no, name, batch.`);
          return;
        }
        startTransition(async () => setResult(await importStudents(parsed.data)));
      },
      error: (error) => setParseError(error.message),
    });
  }

  return (
    <Card className="p-6">
      <h2 className="font-display text-xl font-semibold tracking-tight">Import students</h2>
      <p className="mt-1 text-sm text-muted">
        CSV with columns <code className="font-mono text-ink">roll_no, name, batch</code>. Existing roll numbers are skipped.
      </p>
      <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-line-strong bg-sunken/50 px-4 py-8 text-center hover:border-brand hover:bg-brand-soft/40">
        <span className="text-sm font-semibold text-ink">{pending ? "Creating accounts…" : "Choose a CSV file"}</span>
        <span className="mt-1 text-xs text-faint">Up to 5000 rows per file</span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          disabled={pending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = "";
          }}
        />
      </label>
      {parseError && <p className="mt-4 rounded-xl bg-error-soft px-3.5 py-2.5 text-sm text-error">{parseError}</p>}
      {result && result.errors.length > 0 && (
        <div className="mt-4 rounded-xl bg-error-soft px-3.5 py-2.5 text-sm text-error">
          <p className="font-semibold">Nothing was imported. Fix these rows and upload again:</p>
          <ul className="mt-1 list-disc pl-5">
            {result.errors.slice(0, 20).map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
          {result.errors.length > 20 && <p className="mt-1">…and {result.errors.length - 20} more.</p>}
        </div>
      )}
      {result && result.errors.length === 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold text-pass">
            Created {result.created.length} account{result.created.length === 1 ? "" : "s"}
            {result.skipped.length > 0 && <span className="text-muted"> · skipped {result.skipped.length} existing</span>}
          </p>
          {result.created.length > 0 && <CredentialsTable credentials={result.created} />}
        </div>
      )}
    </Card>
  );
}
