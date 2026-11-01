import { describe, expect, it } from "vitest";
import { redirectTo, siteOrigin } from "./redirect";

describe("redirectTo", () => {
  it("points at a path, not at a host, so it follows the address the browser used", () => {
    const response = redirectTo("/login?next=%2Fstaff");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/login?next=%2Fstaff");
  });

  it("can send a 303 after a GET-style hop", () => {
    expect(redirectTo("/staff/exams", 303).status).toBe(303);
  });
});

describe("siteOrigin", () => {
  const request = (host: string | null, url = "http://0.0.0.0:3000/staff") => ({ url, headers: new Headers(host ? { host } : {}) });

  it("prefers the configured public origin over the address the server bound to", () => {
    process.env.PUBLIC_ORIGIN = "http://192.168.1.24:3000/";
    expect(siteOrigin(request("localhost:3000"))).toBe("http://192.168.1.24:3000");
    delete process.env.PUBLIC_ORIGIN;
  });

  it("falls back to the Host header, not request.url", () => {
    delete process.env.PUBLIC_ORIGIN;
    expect(siteOrigin(request("192.168.1.24:3000"))).toBe("http://192.168.1.24:3000");
  });
});
