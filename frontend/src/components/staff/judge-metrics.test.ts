import { describe, expect, it } from "vitest";
import { failureRate, queueTone } from "./judge-metrics";

describe("judge metrics", () => {
  it("turns amber after a minute's wait and red after five", () => {
    expect([0, 60, 61, 300, 301].map(queueTone)).toEqual(["success", "success", "warning", "warning", "danger"]);
  });

  it("measures failures against everything that finished in the hour", () => {
    expect(failureRate({ completed_last_hour: 90, failed_last_hour: 10 })).toBeCloseTo(0.1);
    expect(failureRate({ completed_last_hour: 0, failed_last_hour: 0 })).toBeNull();
  });
});
