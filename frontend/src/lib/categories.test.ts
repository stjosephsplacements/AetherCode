import { describe, expect, it } from "vitest";
import { inFolderOrder } from "./categories";

const list = [
  { id: "trees", name: "Trees", parent_id: "algo" },
  { id: "algo", name: "Algorithms", parent_id: null },
  { id: "db", name: "Databases" },
  { id: "basics", name: "Basics", parent_id: "db" },
  { id: "lost", name: "Lost", parent_id: "gone" },
];

describe("inFolderOrder", () => {
  it("puts each sub-category right after its parent and labels it with the path", () => {
    expect(inFolderOrder(list).map(({ category, depth, label }) => [category.id, depth, label])).toEqual([
      ["algo", 0, "Algorithms"],
      ["trees", 1, "Algorithms / Trees"],
      ["db", 0, "Databases"],
      ["basics", 1, "Databases / Basics"],
      ["lost", 0, "Lost"],
    ]);
  });

  it("is empty for no categories", () => {
    expect(inFolderOrder([])).toEqual([]);
  });
});
