import { describe, expect, it } from "vitest";
import { isTicketedLaunchFile, sebLaunchURL } from "./seb-launch";

const tenant = "018f4b0d-08f8-7c09-9ba7-efdf9c223001";
const exam = "018f4b0d-08f8-7c09-9ba7-efdf9c223002";
const ticket = "A".repeat(43);

describe("sebLaunchURL", () => {
  it("uses sebs:// for an https origin and keeps the host", () => {
    expect(sebLaunchURL("https://exam-aethercode.stjosephsplacements.in", tenant, exam, ticket)).toBe(
      `sebs://exam-aethercode.stjosephsplacements.in/api/seb/v1/tenants/${tenant}/exams/${exam}/launch-file?ticket=${ticket}`,
    );
  });
  it("uses seb:// for local http development, keeping the port", () => {
    expect(sebLaunchURL("http://localhost:3000", tenant, exam, ticket)).toMatch(/^seb:\/\/localhost:3000\/api\/seb\//);
  });
  it("encodes the ticket", () => {
    expect(sebLaunchURL("https://h.example", tenant, exam, "a b&c")).toContain("ticket=a%20b%26c");
  });
});

describe("isTicketedLaunchFile", () => {
  const path = `/api/seb/v1/tenants/${tenant}/exams/${exam}/launch-file`;
  it("accepts only a GET of the launch file with a well-formed ticket", () => {
    expect(isTicketedLaunchFile("GET", path, `?ticket=${ticket}`)).toBe(true);
    expect(isTicketedLaunchFile("GET", path, "")).toBe(false);
    expect(isTicketedLaunchFile("GET", path, "?ticket=short")).toBe(false);
    expect(isTicketedLaunchFile("POST", path, `?ticket=${ticket}`)).toBe(false);
    expect(isTicketedLaunchFile("GET", `${path}/x`, `?ticket=${ticket}`)).toBe(false);
    expect(isTicketedLaunchFile("GET", `/api/submission/v1/tenants/${tenant}/attempts`, `?ticket=${ticket}`)).toBe(false);
  });
});
