import { describe, expect, it } from "vitest";
import { chosenPolicyVersionId, policyBodyFromForm } from "./proctor-policy-body";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("chosenPolicyVersionId", () => {
  it("trims the selected published version id", () => {
    expect(chosenPolicyVersionId(form({ proctor_policy_version_id: "  abc  " }))).toBe("abc");
    expect(chosenPolicyVersionId(form({}))).toBe("");
  });
});

describe("policyBodyFromForm", () => {
  it("defaults to counting off with no kinds", () => {
    expect(policyBodyFromForm(form({}))).toEqual({
      enabled: false,
      auto_submit_on_breach: false,
    });
  });

  it("reads toggles, limits, and selected kinds", () => {
    expect(
      policyBodyFromForm(
        form({
          enabled: "on",
          auto_submit_on_breach: "on",
          violation_cooldown_seconds: "45",
          max_violations: "3",
          kind_phone_detected: "on",
          kind_face_missing: "on",
        }),
      ),
    ).toEqual({
      enabled: true,
      auto_submit_on_breach: true,
      violation_cooldown_seconds: 45,
      max_violations: 3,
      counted_violation_kinds: ["face_missing", "phone_detected"],
    });
  });

  it("ignores non-positive cooldown and max", () => {
    expect(
      policyBodyFromForm(
        form({
          violation_cooldown_seconds: "0",
          max_violations: "-1",
        }),
      ),
    ).toEqual({
      enabled: false,
      auto_submit_on_breach: false,
    });
  });

  it("ignores non-numeric cooldown and max and truncates decimals", () => {
    expect(
      policyBodyFromForm(
        form({
          violation_cooldown_seconds: "12.9",
          max_violations: "nope",
        }),
      ),
    ).toEqual({
      enabled: false,
      auto_submit_on_breach: false,
      violation_cooldown_seconds: 12,
    });
  });
});
