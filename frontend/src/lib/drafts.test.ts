import { describe, expect, it } from "vitest";
import { draftFields } from "./drafts";

describe("draftFields", () => {
  it("groups repeated names, keeping order", () => {
    const form = new FormData();
    form.append("title", "Midterm");
    form.append("batch_id", "a");
    form.append("batch_id", "b");
    expect(draftFields(form)).toEqual({ title: ["Midterm"], batch_id: ["a", "b"] });
  });

  it("never stores files", () => {
    const form = new FormData();
    form.append("roster", new Blob(["roll,name"]), "roster.csv");
    form.append("note", "");
    expect(draftFields(form)).toEqual({ note: [""] });
  });
});
