import { describe, expect, it } from "vitest";
import { parseStaffLines } from "./staff-csv";

describe("parseStaffLines", () => {
  it("reads username, name and optional email, skipping a header", () => {
    const { rows, problems } = parseStaffLines("username,name,email\nMeera.K, Dr. Meera Krishnan, meera@x.edu\nravi_s,Ravi S\n");
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { username: "meera.k", name: "Dr. Meera Krishnan", email: "meera@x.edu" },
      { username: "ravi_s", name: "Ravi S", email: "" },
    ]);
  });
  it("reports each bad line by number", () => {
    const { rows, problems } = parseStaffLines("ab,Short\nok.user,\nfine.one,Fine,not-an-email\nfine.two,Two\nfine.two,Again");
    expect(rows.map((row) => row.username)).toEqual(["fine.two"]);
    expect(problems).toHaveLength(4);
    expect(problems[0]).toMatch(/Line 1/);
    expect(problems[3]).toMatch(/Line 5.*twice/);
  });
});
