"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ConsortiumDrive, ConsortiumLeaderboardEntry } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { formatDateTime } from "@/lib/utils";

export function ConsortiumDrives({ tracks, tenantId }: { tracks: { id: string; name: string }[]; tenantId: string }) {
  const [trackId, setTrackId] = useState(tracks[0]?.id ?? "");
  const [drives, setDrives] = useState<ConsortiumDrive[]>([]);
  const [board, setBoard] = useState<ConsortiumLeaderboardEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!trackId) return;
    void api<ConsortiumDrive[]>(`/analytics/v1/tenants/${tenantId}/placement-departments/${trackId}/consortium-drives`)
      .then(setDrives)
      .catch(() => setDrives([]));
  }, [trackId, tenantId]);

  useEffect(() => {
    if (!selected || !trackId) {
      setBoard([]);
      return;
    }
    void api<ConsortiumLeaderboardEntry[]>(
      `/analytics/v1/tenants/${tenantId}/placement-departments/${trackId}/consortium-drives/${selected}/leaderboard`,
    )
      .then(setBoard)
      .catch(() => setBoard([]));
  }, [selected, trackId, tenantId]);

  async function createDrive() {
    const title = window.prompt("Drive title?");
    if (!title?.trim()) return;
    const opensAt = new Date().toISOString();
    const closesAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await api(`/analytics/v1/tenants/${tenantId}/placement-departments/${trackId}/consortium-drives`, {
      method: "POST",
      body: { title: title.trim(), opens_at: opensAt, closes_at: closesAt },
    });
    const next = await api<ConsortiumDrive[]>(`/analytics/v1/tenants/${tenantId}/placement-departments/${trackId}/consortium-drives`);
    setDrives(next);
  }

  return (
    <div className="space-y-6">
      <label className="block text-sm">
        <span className="text-ink-muted">Placement track</span>
        <select className="mt-1 w-full max-w-md rounded-control border border-line bg-surface px-3 py-2" value={trackId} onChange={(event) => setTrackId(event.target.value)}>
          {tracks.map((track) => (
            <option key={track.id} value={track.id}>
              {track.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <Button type="button" onClick={() => void createDrive()}>
          New drive
        </Button>
      </div>
      <ul className="divide-y divide-line rounded-panel border border-line bg-surface">
        {drives.length === 0 ? (
          <li className="px-4 py-6 text-sm text-ink-muted">No drives on this track yet.</li>
        ) : (
          drives.map((drive) => (
            <li key={drive.id}>
              <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-hover/40" onClick={() => setSelected(drive.id)}>
                <span className="font-medium text-ink">{drive.title}</span>
                <span className="text-[12px] text-ink-muted">
                  {formatDateTime(drive.opens_at)} – {formatDateTime(drive.closes_at)}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
      {selected && (
        <section className="rounded-panel border border-line bg-surface p-4">
          <h2 className="text-[15px] font-semibold text-ink">Leaderboard</h2>
          <ol className="mt-3 space-y-1 font-mono text-[13px]">
            {board.map((entry, index) => (
              <li key={`${entry.tenant_id}-${entry.student_id}`}>
                {index + 1}. {entry.student_id.slice(0, 8)} · score {entry.score ?? "-"}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}