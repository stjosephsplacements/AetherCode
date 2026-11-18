import { describe, expect, it } from "vitest";
import { clientAddress } from "./client-ip";

describe("clientAddress", () => {
  it.each([
    ["203.0.113.8", "203.0.113.8"],
    ["203.0.113.8, 10.42.0.5", "203.0.113.8"],
    ["10.9.9.9, 198.51.100.7, 127.0.0.1, 10.42.0.5", "198.51.100.7"],
    ["192.0.2.1, 198.51.100.7", "198.51.100.7"],
    ["10.5.5.5, 10.42.0.5", "10.5.5.5"],
    ["2001:db8::7, fd00::1", "2001:db8::7"],
    ["", null],
  ])("%s -> %s", (chain, expected) => {
    expect(clientAddress(chain)).toBe(expected);
  });

  it("returns null without a header", () => {
    expect(clientAddress(null)).toBeNull();
  });
});
