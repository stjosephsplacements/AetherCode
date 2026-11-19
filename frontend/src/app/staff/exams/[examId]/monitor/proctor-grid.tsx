"use client";

import { useEffect, useState } from "react";
import { EmptyState, Section } from "@/components/staff/page-header";
import { LocalPager } from "@/components/staff/pager";
import { Badge, Panel } from "@/components/ui/card";
import type { ProctorGridSeverity, ProctorGridTile } from "@/lib/api-types";
import { APIError, api } from "@/lib/client/api";
import { paginate } from "@/lib/paginate";
import { formatTime } from "@/lib/utils";

const POLL_MS = 10_000;

const SEVERITY: Record<ProctorGridSeverity, { label: string; tone: "success" | "warning" | "danger"; ring: string }> = {
  green: { label: "Clear", tone: "success", ring: "border-line" },
  amber: { label: "Watch", tone: "warning", ring: "border-warning" },
  red: { label: "Limit reached", tone: "danger", ring: "border-danger" },
};

const KIND_LABEL: Record<string, string> = {
  face_missing: "No face",
  multiple_faces: "Several faces",
  phone_detected: "Phone",
  gaze_away: "Looking away",
};

/**
 * Camera grid of the attempts in progress, noisiest first. Colour comes from
 * the server. A 403 means the viewer lacks the student-PII permission, so the
 * grid says so and the rest of the monitor is unaffected.
 */
export function ProctorGrid({
  tenantId,
  versionId,
  rollNumber,
}: {
  tenantId: string;
  versionId: string;
  rollNumber: Record<string, string>;
}) {
  const [tiles, setTiles] = useState<ProctorGridTile[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const paged = paginate(tiles ?? [], page, 24);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const next = await api<ProctorGridTile[]>(`/submission/v1/tenants/${tenantId}/exam-versions/${versionId}/proctor-grid`, {
          signal: controller.signal,
        });
        setTiles(next);
        setProblem(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        setProblem(
          error instanceof APIError && error.code === "mfa_required"
            ? "Confirm your authenticator code again to keep viewing the camera grid. It is re-checked every five minutes."
            : error instanceof APIError && error.status === 403
              ? "Viewing the camera grid needs the student personal data permission."
              : "The camera grid could not be loaded. It will retry.",
        );
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [tenantId, versionId]);

  return (
    <Section title="Camera grid" description="Attempts in progress with the newest webcam frame. Refreshes every 10 seconds.">
      {problem ? (
        <EmptyState>{problem}</EmptyState>
      ) : tiles === null ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : tiles.length === 0 ? (
        <EmptyState>No attempt is in progress.</EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {paged.rows.map((tile) => {
            const severity = SEVERITY[tile.severity];
            const kinds = Object.entries(tile.violation_kinds);
            return (
              <li key={tile.attempt_id}>
                <Panel className={`overflow-hidden border-2 ${severity.ring}`}>
                  {tile.snapshot_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a short-lived presigned URL
                    <img src={tile.snapshot_url} alt={`Webcam of ${rollNumber[tile.candidate_id] ?? "a candidate"}`} className="aspect-[4/3] w-full bg-surface-2 object-cover" />
                  ) : (
                    <div className="grid aspect-[4/3] w-full place-items-center bg-surface-2 text-xs text-ink-subtle">No frame yet</div>
                  )}
                  <div className="space-y-1.5 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{rollNumber[tile.candidate_id] ?? tile.candidate_id.slice(0, 8)}</span>
                      <Badge tone={severity.tone}>{severity.label}</Badge>
                    </div>
                    <p className="text-xs text-ink-muted">
                      {tile.violation_total === 0
                        ? "No violations"
                        : kinds.map(([kind, count]) => `${KIND_LABEL[kind] ?? kind} ×${count}`).join(", ")}
                    </p>
                    {tile.captured_at ? <p className="text-xs text-ink-subtle">Frame at {formatTime(tile.captured_at)}</p> : null}
                  </div>
                </Panel>
              </li>
            );
          })}
        </ul>
      )}
      <LocalPager meta={paged} onPage={setPage} noun="cameras" />
    </Section>
  );
}
