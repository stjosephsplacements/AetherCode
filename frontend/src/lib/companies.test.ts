import { describe, expect, it } from "vitest";
import { companiesIn, companyName, isCompanyTag, matchesCompany } from "./companies";
import { normalizeTag } from "@/components/staff/question-wizard/model";

describe("company tags", () => {
  it("recognises only company: tags with a name", () => {
    expect(isCompanyTag("company:tcs")).toBe(true);
    expect(isCompanyTag("company:")).toBe(false);
    expect(isCompanyTag("dp")).toBe(false);
    expect(isCompanyTag("my-company:x")).toBe(false);
  });

  it("lists each company once, sorted", () => {
    expect(companiesIn([["dp", "company:zoho"], ["company:tcs", "company:zoho"], []])).toEqual(["company:tcs", "company:zoho"]);
    expect(companyName("company:infosys")).toBe("infosys");
  });

  it("filters by company, or not at all", () => {
    expect(matchesCompany(["company:tcs"], "all")).toBe(true);
    expect(matchesCompany(["company:tcs"], "company:tcs")).toBe(true);
    expect(matchesCompany(["dp"], "company:tcs")).toBe(false);
  });

  it("keeps the colon when a tag is typed", () => {
    expect(normalizeTag("Company:TCS")).toBe("company:tcs");
    expect(normalizeTag(" company: Zoho ")).toBe("company:zoho");
  });
});
