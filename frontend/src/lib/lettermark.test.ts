import { describe, expect, test } from "vitest";
import { lettermark } from "./lettermark";

describe("lettermark", () => {
  test("two words → initials", () => expect(lettermark("St Joseph")).toBe("SJ"));
  test("one word → first two letters", () => expect(lettermark("Admin")).toBe("AD"));
  test("empty string → ?", () => expect(lettermark("")).toBe("?"));
  test("whitespace-only → ?", () => expect(lettermark("   ")).toBe("?"));
  test("three words → first two initials", () => expect(lettermark("Aether Code Platform")).toBe("AC"));
  test("single char → padded", () => expect(lettermark("X")).toBe("X"));
});
