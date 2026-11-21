"use client";

import { CircleNotch } from "@phosphor-icons/react/ssr";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Snapshot } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { appendPage, pageExhausted, SNAPSHOT_PAGE_SIZE } from "@/lib/snapshot-pages";

export function SnapshotsGallery({
  tenantId,
  attemptId,
  initial,
}: {
  tenantId: string;
  attemptId: string;
  initial: Snapshot[];
}) {
  const [snapshots, setSnapshots] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(pageExhausted(initial.length, SNAPSHOT_PAGE_SIZE));

  async function loadEarlier() {
    const oldest = snapshots[snapshots.length - 1];
    if (!oldest || exhausted) return;
    setLoading(true);
    setError(null);
    try {
      const next = await api<Snapshot[]>(
        `/submission/v1/tenants/${tenantId}/attempts/${attemptId}/snapshots?limit=${SNAPSHOT_PAGE_SIZE}&before=${encodeURIComponent(oldest.id)}`,
      );
      setSnapshots((prev) => appendPage(prev, next, SNAPSHOT_PAGE_SIZE).items);
      setExhausted(pageExhausted(next.length, SNAPSHOT_PAGE_SIZE));
    } catch {
      setError("Earlier snapshots could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {snapshots.map((snap) => (
          <a key={snap.id} href={snap.url} target="_blank" rel="noopener noreferrer">
            <img src={snap.url} width={120} height={90} title={snap.captured_at} alt={`Snapshot at ${snap.captured_at}`} className="rounded border border-line object-cover" />
          </a>
        ))}
      </div>
      {!exhausted ? (
        <div className="mt-3">
          <Button type="button" variant="secondary" size="sm" disabled={loading} onClick={() => void loadEarlier()}>
            {loading ? <CircleNotch className="animate-spin" /> : null}
            Load earlier
          </Button>
          {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
