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

/** Assessment also accepts uppercase aliases from older policy bodies. */
const KIND_ALIASES: Record<string, ViolationKind> = {
  NO_FACE: "face_missing",
  MULTIPLE_FACES: "multiple_faces",
  PROHIBITED_DEVICE: "phone_detected",
  GAZE_AWAY: "gaze_away",
  face_missing: "face_missing",
  multiple_faces: "multiple_faces",
  phone_detected: "phone_detected",
  gaze_away: "gaze_away",
};

export const POLICY_KIND_OPTIONS = VIOLATION_KINDS.map((value) => ({
  value,
  label: VIOLATION_KIND_META[value].full,
}));

function isViolationKind(kind: string): kind is ViolationKind {
  return (VIOLATION_KINDS as readonly string[]).includes(kind);
}

/** Map API / legacy names onto the canonical snake_case kind. */
export function canonicalViolationKind(kind: string): ViolationKind | undefined {
  return KIND_ALIASES[kind] ?? (isViolationKind(kind) ? kind : undefined);
}

/** Deduplicate and canonicalize counted kinds for forms and saves. */
export function normalizeCountedKinds(kinds: readonly string[] | undefined): ViolationKind[] {
  if (!kinds?.length) return [];
  const seen = new Set<ViolationKind>();
  for (const kind of kinds) {
    const canonical = canonicalViolationKind(kind);
    if (canonical) seen.add(canonical);
  }
  return VIOLATION_KINDS.filter((kind) => seen.has(kind));
}

/** Known webcam kinds only; callers fall back when undefined. */
export function violationKindLabel(kind: string, style: "short" | "full" = "full"): string | undefined {
  const canonical = canonicalViolationKind(kind);
  if (!canonical) return undefined;
  return VIOLATION_KIND_META[canonical][style];
}
