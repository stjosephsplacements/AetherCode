import { describe, expect, it } from "vitest";
import { type CandidateRow, departmentStats, lettermark, orgStats, percent, sortDepartments } from "./stats";

const row = (id: string, department: string, placementId = ""): CandidateRow => ({ id, roll: id, name: id, status: "active", college: "C", batchId: "b", batch: "B", departmentId: department, department: department.toUpperCase(), placementId });
const rows = [row("1", "cse", "p1"), row("2", "cse"), row("3", "cse", "p2"), row("4", "ece"), row("5", "")];

describe("percent", () => {
  it("rounds and survives an empty whole", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(0, 0)).toBe(0);
  });
});

describe("departmentStats", () => {
  it("counts total, assigned and pending per department", () => {
    const stats = departmentStats(rows);
    expect(stats.find((entry) => entry.id === "cse")).toMatchObject({ total: 3, assigned: 2, pending: 1, percent: 67 });
    expect(stats.find((entry) => entry.id === "none")).toMatchObject({ label: "No department", total: 1, pending: 1, percent: 0 });
  });
});

describe("sortDepartments", () => {
  const stats = departmentStats(rows);
  it("sorts by a number or by name, either way", () => {
    expect(sortDepartments(stats, "total", true)[0]!.id).toBe("cse");
    expect(sortDepartments(stats, "percent", false)[0]!.percent).toBe(0);
    expect(sortDepartments(stats, "label", false).map((entry) => entry.label)).toEqual(["CSE", "ECE", "No department"]);
  });
});

describe("orgStats", () => {
  it("adds up the students in each track", () => {
    const [org] = orgStats(rows, [{ id: "o", name: "Org", code: "O", status: "active", tracks: [{ id: "p1", label: "P1" }, { id: "p2", label: "P2" }, { id: "p3", label: "P3" }] }]);
    expect(org!.assigned).toBe(2);
    expect(org!.perTrack.map((entry) => entry.assigned)).toEqual([1, 1, 0]);
  });
});

describe("lettermark", () => {
  it("takes two letters", () => {
    expect(lettermark("Zoho Corporation")).toBe("ZC");
    expect(lettermark("infosys")).toBe("IN");
    expect(lettermark("")).toBe("?");
  });
});
