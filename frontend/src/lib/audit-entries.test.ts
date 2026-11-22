import { describe, expect, it } from "vitest";
import { asAuditEntries } from "./audit-entries";

describe("asAuditEntries", () => {
  const row = {
    occurred_at: "2026-01-01T00:00:00Z",
    principal_id: "p1",
    service: "tenant",
    resource_type: "batches",
    resource_id: "r1",
    allowed: true,
  };

  it("accepts a bare array", () => {
    expect(asAuditEntries([row])).toEqual([row]);
  });

  it("accepts the OpenAPI { entries } envelope", () => {
    expect(asAuditEntries({ entries: [row] })).toEqual([row]);
  });

  it("returns empty for junk", () => {
    expect(asAuditEntries(undefined)).toEqual([]);
    expect(asAuditEntries(null)).toEqual([]);
    expect(asAuditEntries({})).toEqual([]);
  });
});
