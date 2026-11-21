import { SNAPSHOT_PAGE_SIZE } from "@/lib/snapshot-pages";

export { SNAPSHOT_PAGE_SIZE };

export const VIOLATION_KINDS = ["face_missing", "multiple_faces", "phone_detected", "gaze_away"] as const;

export type ViolationKind = (typeof VIOLATION_KINDS)[number];

const VIOLATION_KIND_META: Record<ViolationKind, { short: string; full: string }> = {
  face_missing: { short: "No face", full: "No face in frame" },
  multiple_faces: { short: "Several faces", full: "Multiple people in frame" },
  phone_detected: { short: "Phone", full: "Phone detected (GPU)" },
  gaze_away: { short: "Looking away", full: "Looking away from screen" },
};

export const POLICY_KIND_OPTIONS = VIOLATION_KINDS.map((value) => ({
  value,
  label: VIOLATION_KIND_META[value].full,
}));

function isViolationKind(kind: string): kind is ViolationKind {
  return (VIOLATION_KINDS as readonly string[]).includes(kind);
}

/** Known webcam kinds only; callers fall back when undefined. */
export function violationKindLabel(kind: string, style: "short" | "full" = "full"): string | undefined {
  if (!isViolationKind(kind)) return undefined;
  return VIOLATION_KIND_META[kind][style];
}