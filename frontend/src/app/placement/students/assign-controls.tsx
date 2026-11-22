"use client";

import { useState, useTransition } from "react";
import type { ActionState } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/staff/form";

export function AssignControls({
  collegeId,
  studentId,
  tracks,
  action,
}: {
  collegeId: string;
  studentId: string;
  tracks: { id: string; label: string }[];
  action: (collegeId: string, studentId: string, placementDepartmentId: string) => Promise<ActionState>;
}) {
  const [trackId, setTrackId] = useState(tracks[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (tracks.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {tracks.length > 1 && (
        <Select
          aria-label="Placement track"
          value={trackId}
          onValueChange={setTrackId}
          size="sm"
          className="w-[min(100%,12rem)]"
        >
          {tracks.map((track) => (
            <option key={track.id} value={track.id}>
              {track.label}
            </option>
          ))}
        </Select>
      )}
      <Button
        size="sm"
        disabled={pending || !trackId}
        onClick={() => {
          setError(null);
          start(async () => {
            const result = await action(collegeId, studentId, trackId);
            if (result.error) setError(result.error);
          });
        }}
      >
        Assign
      </Button>
      {error && <p className="basis-full text-right text-[12px] text-danger">{error}</p>}
    </div>
  );
}

export function ClearControls({
  collegeId,
  studentId,
  currentPlacementId,
  action,
}: {
  collegeId: string;
  studentId: string;
  currentPlacementId: string;
  action: (collegeId: string, studentId: string, currentPlacementId: string) => Promise<ActionState>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const result = await action(collegeId, studentId, currentPlacementId);
            if (result.error) setError(result.error);
          });
        }}
      >
        Remove
      </Button>
      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}
