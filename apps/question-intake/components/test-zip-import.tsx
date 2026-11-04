"use client";

import { unzipSync, strFromU8 } from "fflate";
import { UploadSimple } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import type { TestDraft } from "@/lib/draft";
import { MAX_FILE_BYTES, pairTestFiles } from "@/lib/test-zip";
import { Button } from "@/components/ui";

const MAX_ZIP_BYTES = 20_000_000;

/** Reads a zip of paired input/output files in the browser and hands back the tests; nothing is uploaded until the question is saved. */
export function TestZipImport({ onImport }: { onImport: (tests: TestDraft[], mode: "replace" | "append") => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"replace" | "append">("append");
  const [report, setReport] = useState<{ count: number; samples: number; problems: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function read(file: File) {
    setError(null);
    setReport(null);
    if (file.size > MAX_ZIP_BYTES) return setError("The zip is larger than 20 MB.");
    try {
      const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (entry) => entry.originalSize <= MAX_FILE_BYTES });
      const files = Object.fromEntries(Object.entries(entries).filter(([path, data]) => !path.endsWith("/") && data.length > 0).map(([path, data]) => [path, strFromU8(data)]));
      const { tests, problems } = pairTestFiles(files);
      if (tests.length === 0) return setError(problems[0] ?? "No input and output pairs found in the zip.");
      onImport(tests, mode);
      setReport({ count: tests.length, samples: tests.filter((entry) => entry.is_sample).length, problems });
    } catch {
      setError("That file is not a readable zip.");
    }
  }

  return (
    <div className="mb-4 rounded-[var(--radius-control)] border border-dashed border-line-strong p-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-muted">
          Upload a zip of paired files: <span className="font-mono">1.in</span> with <span className="font-mono">1.out</span>. Files inside a <span className="font-mono">sample/</span> folder become samples, the rest hidden.
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-ink-muted">
            <input type="radio" name="zip-mode" checked={mode === "append"} onChange={() => setMode("append")} /> Add to existing
          </label>
          <label className="flex items-center gap-2 text-ink-muted">
            <input type="radio" name="zip-mode" checked={mode === "replace"} onChange={() => setMode("replace")} /> Replace all
          </label>
          <Button variant="secondary" onClick={() => input.current?.click()}>
            <UploadSimple className="size-3.5" /> Upload zip
          </Button>
          <input ref={input} type="file" accept=".zip,application/zip" hidden aria-label="Test cases zip" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void read(file); }} />
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
      {report && (
        <div className="mt-2 text-ink-muted">
          <p>Imported {report.count} tests ({report.samples} sample, {report.count - report.samples} hidden). Edit weights below.</p>
          {report.problems.length > 0 && <ul className="mt-1 list-disc pl-5 text-danger">{report.problems.slice(0, 8).map((problem) => <li key={problem}>{problem}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
