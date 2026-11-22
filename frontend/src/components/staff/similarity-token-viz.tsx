"use client";

import type { SimilarityAlign } from "@/lib/api-types";
import { cn } from "@/lib/utils";

export function SimilarityTokenViz({ align }: { align: SimilarityAlign }) {
  const rows = align.tokens_a.map((token, index) => ({
    a: token,
    b: align.tokens_b[index] ?? "",
    shared: align.shared[index],
  }));
  return (
    <section className="mt-6 overflow-hidden rounded-panel border border-line bg-surface">
      <header className="border-b border-line bg-sunken px-4 py-2 text-[13px] text-ink-muted">
        Token alignment (winnowing normalisation) · MOSS score {Math.round(align.score * 100)}% · {align.shared_fingerprints} shared fingerprints
      </header>
      <div className="max-h-[40vh] overflow-auto font-mono text-[12px]">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface text-left text-ink-subtle">
            <tr>
              <th className="px-3 py-2 w-8">#</th>
              <th className="px-3 py-2">Left</th>
              <th className="px-3 py-2">Right</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className={cn(row.shared && row.a !== "" && "bg-warning-soft/50")}>
                <td className="px-3 py-0.5 text-ink-subtle">{index + 1}</td>
                <td className="px-3 py-0.5 text-ink">{row.a || "·"}</td>
                <td className="px-3 py-0.5 text-ink">{row.b || "·"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}