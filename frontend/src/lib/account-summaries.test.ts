import { describe, expect, it } from "vitest";
import { asAccountSummaries } from "./account-summaries";

describe("asAccountSummaries", () => {
  it("accepts a bare array", () => {
    expect(asAccountSummaries([{ principal_id: "a", display_name: "A", status: "active" }])).toEqual([
      { principal_id: "a", display_name: "A", status: "active" },
    ]);
  });

  it("accepts the OpenAPI { accounts } envelope", () => {
    expect(asAccountSummaries({ accounts: [{ principal_id: "b", display_name: "B", status: "active" }] })).toEqual([
      { principal_id: "b", display_name: "B", status: "active" },
    ]);
  });

  it("returns empty for junk", () => {
    expect(asAccountSummaries(undefined)).toEqual([]);
    expect(asAccountSummaries(null)).toEqual([]);
    expect(asAccountSummaries({})).toEqual([]);
    expect(asAccountSummaries({ accounts: "nope" })).toEqual([]);
  });
});
