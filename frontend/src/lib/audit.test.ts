import { describe, expect, it } from "vitest";
import { auditAction } from "./audit";

describe("auditAction", () => {
  it("describes a write on a known resource", () => {
    expect(auditAction({ service: "assessment", resource_type: "exams" })).toBe("Created or duplicated an exam");
  });

  it("says when something was deleted, whatever the resource", () => {
    expect(auditAction({ service: "assessment", resource_type: "exams", action: "delete" })).toBe("Deleted exam (assessment)");
    expect(auditAction({ service: "tenant", resource_type: "batches", action: "delete" })).toBe("Deleted batch (tenant)");
  });

  it("reads an entry with no verb as a write", () => {
    expect(auditAction({ service: "tenant", resource_type: "batches", action: undefined })).toBe("Created or changed a batch");
  });
});
