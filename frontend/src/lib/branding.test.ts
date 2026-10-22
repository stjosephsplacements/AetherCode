import { describe, expect, it } from "vitest";
import { accentStyle, logoFiles, parseBranding, pickBrand, usableAccent } from "./branding";

const TENANT = "018f4b0d-08f8-7c09-9ba7-efdf9c220001";

describe("branding", () => {
  it("accepts mid-tone accents only", () => {
    expect(usableAccent("#b5532e")).toBe(true);
    expect(usableAccent("#2563eb")).toBe(true);
    expect(usableAccent("#ffff00")).toBe(false); // unreadable on the light canvas
    expect(usableAccent("#101010")).toBe(false); // unreadable on the dark canvas
    expect(usableAccent("red")).toBe(false);
  });

  it("applies a college's entry over the default", () => {
    const { config, problems } = parseBranding(
      JSON.stringify({ default: { name: "Campus", color: "#b5532e" }, tenants: { [TENANT]: { name: "St. Joseph's", logo: "sjc.png" } } }),
    );
    expect(problems).toEqual([]);
    expect(pickBrand(config, TENANT.toUpperCase())).toEqual({ name: "St. Joseph's", color: "#b5532e", logo: "sjc.png" });
    expect(pickBrand(config, null)).toEqual({ name: "Campus", color: "#b5532e" });
  });

  it("drops invalid entries and says why", () => {
    const { config, problems } = parseBranding(JSON.stringify({ default: { color: "#ffff00", logo: "../../etc/passwd", name: "" }, tenants: { nope: {} } }));
    expect(config.default).toEqual({});
    expect(problems).toHaveLength(4);
    expect(parseBranding("{").problems).toEqual(["not valid JSON"]);
  });

  it("picks a readable text colour for the accent", () => {
    expect(accentStyle("#2563eb")["--brand-ink"]).toBe("#fdfdfb");
    expect(accentStyle("#d97757")["--brand-ink"]).toBe("#1f1e1d");
  });

  it("lists up to five logos in order, falling back to the single logo", () => {
    const { config, problems } = parseBranding(JSON.stringify({ default: { logo: "one.png" }, tenants: { [TENANT]: { logos: ["a.png", "b.svg"] } } }));
    expect(problems).toEqual([]);
    expect(logoFiles(pickBrand(config, TENANT))).toEqual(["a.png", "b.svg"]);
    expect(logoFiles(pickBrand(config, null))).toEqual(["one.png"]);
    expect(parseBranding(JSON.stringify({ default: { logos: ["a.png", "../b.png"] } })).problems).toHaveLength(1);
    expect(parseBranding(JSON.stringify({ default: { logos: ["1.png", "2.png", "3.png", "4.png", "5.png", "6.png"] } })).problems).toHaveLength(1);
  });
});
