import { describe, expect, it } from "vitest";
import {
  canonicalViolationKind,
  normalizeCountedKinds,
  POLICY_KIND_OPTIONS,
  SNAPSHOT_PAGE_SIZE,
  VIOLATION_KINDS,
  violationKindLabel,
} from "./proctor-kinds";

describe("proctor-kinds", () => {
  it("exposes the four canonical detector kinds", () => {
    expect(VIOLATION_KINDS).toEqual(["face_missing", "multiple_faces", "phone_detected", "gaze_away"]);
  });

  it("builds policy options from the canonical kinds", () => {
    expect(POLICY_KIND_OPTIONS.map((option) => option.value)).toEqual([...VIOLATION_KINDS]);
    expect(POLICY_KIND_OPTIONS.every((option) => option.label.length > 0)).toBe(true);
  });

  it("labels known kinds in full and short styles", () => {
    expect(violationKindLabel("phone_detected")).toBe("Phone detected (GPU)");
    expect(violationKindLabel("phone_detected", "short")).toBe("Phone");
    expect(violationKindLabel("face_missing", "full")).toBe("No face in frame");
  });

  it("returns undefined for unknown kinds so callers can fall back", () => {
    expect(violationKindLabel("blur")).toBeUndefined();
    expect(violationKindLabel("LOOKING_UP", "short")).toBeUndefined();
    expect(violationKindLabel("")).toBeUndefined();
  });

  it("keeps the snapshot page size at the API cap", () => {
    expect(SNAPSHOT_PAGE_SIZE).toBe(200);
  });

  it("maps uppercase aliases onto canonical kinds", () => {
    expect(canonicalViolationKind("NO_FACE")).toBe("face_missing");
    expect(canonicalViolationKind("PROHIBITED_DEVICE")).toBe("phone_detected");
    expect(normalizeCountedKinds(["NO_FACE", "gaze_away", "NO_FACE"])).toEqual(["face_missing", "gaze_away"]);
  });
});
