import { describe, expect, it } from "vitest";
import { isResetPath } from "./auth-paths";

describe("isResetPath", () => {
  it("covers the forgot and reset pages and nothing else", () => {
    expect(isResetPath("/auth/reset-password")).toBe(true);
    expect(isResetPath("/auth/forgot-password")).toBe(true);
    expect(isResetPath("/auth/reset-password/")).toBe(true);
    expect(isResetPath("/auth/reset-passwords")).toBe(false);
    expect(isResetPath("/login")).toBe(false);
    expect(isResetPath("/")).toBe(false);
  });
});
