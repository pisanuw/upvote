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

describe("normalizeEmailAddress (NextAuth v4's default normalizer, stricter)", () => {
  it.each([
    ["alice@example.com", "alice@example.com"],
    ["  Alice@Example.COM ", "alice@example.com"],
    ["ＡＬＩＣＥ@example.com", "alice@example.com"],
    ["alice.smith+tag@example.co.uk", "alice.smith+tag@example.co.uk"],
  ])("stores %j as %s", (typed, stored) => expect(normalizeEmailAddress(typed)).toBe(stored));

  it.each(["", "alice", "a@b@c.com", 'a"b@c.com', "alice@localhost", "@example.com", "alice@"])("refuses %j", (typed) => {
    expect(() => normalizeEmailAddress(typed)).toThrow("Invalid email address format.");
  });

  // Forms nodemailer reads as a display name or a list, which would mail the
  // victim under another key and get past the per-address limits.
  it.each([
    "a <victim@uw.test>",
    "<victim@uw.test>",
    "victim@uw.test (x)",
    "a@b.co,evil.example",
    "victim@uw.test;x.co",
    "a:victim@uw.test",
    "vic tim@uw.test",
    "victim@uw.test\tx",
    "victim@uw.test\nx",
  ])("refuses %j (whitespace or < > ( ) , ; :)", (typed) => {
    expect(() => normalizeEmailAddress(typed)).toThrow("Invalid email address format.");
  });

  it("is idempotent, so a stored address is its own normal form", () => {
    for (const typed of ["  Alice@Example.COM ", "ＡＬＩＣＥ@example.com"]) {
      const once = normalizeEmailAddress(typed);
      expect(normalizeEmailAddress(once)).toBe(once);
    }
  });
});
