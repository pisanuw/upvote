import { describe, it, expect } from "vitest";
import { normalizeEmailAddress, normalizeSignInCode } from "./sign-in-code";

describe("normalizeSignInCode", () => {
  it.each([
    ["123456", "123456"],
    ["012345", "012345"],
    ["000000", "000000"],
    ["123 456", "123456"],
    ["123-456", "123456"],
    ["  123456\n", "123456"],
    ["1 2 3 4 5 6", "123456"],
    ["１２３４５６", "123456"],
  ])("reads %j as %s", (typed, code) => expect(normalizeSignInCode(typed)).toBe(code));

  it.each(["", "12345", "1234567", "12345a", "123.456", "123_456", "abcdef", "١٢٣٤٥٦", "1".repeat(65)])(
    "refuses %j",
    (typed) => expect(normalizeSignInCode(typed)).toBeNull(),
  );

  it("refuses anything but a string", () => {
    for (const value of [null, undefined, 123456, ["123456"], { code: "123456" }]) {
      expect(normalizeSignInCode(value)).toBeNull();
    }
  });
});

describe("normalizeEmailAddress (NextAuth v4's default normalizer)", () => {
  it.each([
    ["alice@example.com", "alice@example.com"],
    ["  Alice@Example.COM ", "alice@example.com"],
    ["a@b.co,evil.example", "a@b.co"],
    ["ＡＬＩＣＥ@example.com", "alice@example.com"],
  ])("stores %j as %s", (typed, stored) => expect(normalizeEmailAddress(typed)).toBe(stored));

  it.each(["", "alice", "a@b@c.com", 'a"b@c.com', "alice@localhost", "@example.com", "alice@"])("refuses %j", (typed) => {
    expect(() => normalizeEmailAddress(typed)).toThrow("Invalid email address format.");
  });

  it("is idempotent, so a stored address is its own normal form", () => {
    for (const typed of ["  Alice@Example.COM ", "a@b.co,evil.example"]) {
      const once = normalizeEmailAddress(typed);
      expect(normalizeEmailAddress(once)).toBe(once);
    }
  });
});
