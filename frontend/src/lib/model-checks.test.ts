import { describe, expect, it } from "vitest";
import type { ModelCheck } from "./api-types";
import { checkStatus, firstProblem, isVerified, newestFirst, passedCount } from "./model-checks";

const unit = (n: number, verdict = "accepted") => ({ unit_number: n, verdict, weight: 1 });
const check = (patch: Partial<ModelCheck>): ModelCheck => ({
  id: "c", language: "python3", lifecycle_state: "completed", verdict: "accepted", units: [unit(0), unit(1)], requested_at: "2026-11-01T10:00:00Z", completed_at: "2026-11-01T10:00:05Z", current: true, ...patch,
});

describe("model checks", () => {
  it("is idle until something has run", () => {
    expect(checkStatus([])).toBe("idle");
  });

  it("is verified only by a passing check on the current tests", () => {
    expect(checkStatus([check({})])).toBe("verified");
    expect(isVerified([check({ current: false })])).toBe(false);
    expect(checkStatus([check({ current: false })])).toBe("stale");
    expect(isVerified([check({ verdict: "wrong_answer", units: [unit(0), unit(1, "wrong_answer")] })])).toBe(false);
  });

  it("keeps the gate shut while a check is still running", () => {
    expect(checkStatus([check({ lifecycle_state: "queued", verdict: null, units: [] }), check({})])).toBe("running");
  });

  it("reports a failing check on the current tests, and one Judge could not run", () => {
    const failing = check({ verdict: "wrong_answer", units: [unit(0), unit(1, "wrong_answer")] });
    expect(checkStatus([failing])).toBe("failing");
    expect(passedCount(failing)).toBe(1);
    expect(checkStatus([check({ lifecycle_state: "failed", verdict: null, units: [] })])).toBe("unrunnable");
  });

  it("looks at the newest check when there is no passing one", () => {
    const older = check({ requested_at: "2026-11-01T09:00:00Z", verdict: "wrong_answer", current: false, units: [unit(0, "wrong_answer")] });
    const newer = check({ requested_at: "2026-11-01T11:00:00Z", verdict: "runtime_error", units: [unit(0, "runtime_error")] });
    expect(newestFirst([older, newer])[0]).toBe(newer);
    expect(checkStatus([older, newer])).toBe("failing");
  });

  it("points at the first failing test in words", () => {
    expect(firstProblem(check({ units: [unit(0), unit(1, "time_limit_exceeded")] }))).toMatch(/^Test 2: .*time limit/);
    expect(firstProblem(check({}))).toBeNull();
  });
});
