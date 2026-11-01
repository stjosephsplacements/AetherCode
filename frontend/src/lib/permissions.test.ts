import { describe, expect, it } from "vitest";
import { addPermission, groupResources, isLockedRead, removePermission, resourceLabel, sameSet, withImplied, type CataloguePermission } from "./permissions";

const entry = (service: string, resource: string, verb: "read" | "write" | "delete", platform_only = false): CataloguePermission => ({ key: `${service}.${resource}.${verb}`, service, resource, verb, platform_only });

describe("implied reads", () => {
  it("adds the read that write and delete imply", () => {
    expect([...withImplied(["assessment.exams.write"])].sort()).toEqual(["assessment.exams.read", "assessment.exams.write"]);
    expect([...withImplied(["tenant.batches.delete"])].sort()).toEqual(["tenant.batches.delete", "tenant.batches.read"]);
    expect([...withImplied(["user.students.read"])]).toEqual(["user.students.read"]);
  });

  it("dropping write in grants read too", () => {
    expect(addPermission(new Set(), "assessment.exams.write").has("assessment.exams.read")).toBe(true);
  });

  it("will not take out a read that write depends on", () => {
    const held = addPermission(new Set(), "assessment.exams.write");
    expect(isLockedRead("assessment.exams.read", held)).toBe(true);
    expect(removePermission(held, "assessment.exams.read")).toBe(held);
    const without = removePermission(held, "assessment.exams.write");
    expect([...without]).toEqual(["assessment.exams.read"]);
    expect(isLockedRead("assessment.exams.read", without)).toBe(false);
    expect(removePermission(without, "assessment.exams.read").size).toBe(0);
  });

  it("compares sets without caring about order", () => {
    expect(sameSet(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(sameSet(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
  });
});

describe("the pool", () => {
  const catalogue = [
    entry("assessment", "exams", "read"),
    entry("assessment", "exams", "write"),
    entry("assessment", "exams", "delete"),
    entry("tenant", "tenants", "read", true),
    entry("seb", "mystery_things", "read"),
    entry("user", "students", "write"),
    entry("user", "students", "read"),
  ];

  it("groups resources by area in a fixed order, with their verbs in order", () => {
    const groups = groupResources(catalogue);
    expect(groups.map((group) => group.area)).toEqual(["Exams", "Students and staff", "Platform", "Other"]);
    expect(groups[0]!.resources[0]).toMatchObject({ id: "assessment.exams", label: "Exams", verbs: ["read", "write", "delete"], platformOnly: false });
    expect(groups[1]!.resources[0]!.verbs).toEqual(["read", "write"]);
    expect(groups[2]!.resources[0]!.platformOnly).toBe(true);
  });

  it("names a resource from its table name", () => {
    expect(resourceLabel("exam_sections")).toBe("Exam sections");
  });
});
