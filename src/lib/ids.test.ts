import { describe, it, expect } from "vitest";
import { createShareCode, createAdminCode, createAnonVoterKey } from "./ids";

describe("createShareCode", () => {
  it("returns an 8-character string", () => {
    expect(createShareCode()).toHaveLength(8);
  });

  it("uses only lowercase alphanumeric characters", () => {
    for (let i = 0; i < 20; i++) {
      expect(createShareCode()).toMatch(/^[0-9a-z]{8}$/);
    }
  });

  it("generates unique codes", () => {
    const codes = new Set(Array.from({ length: 100 }, createShareCode));
    expect(codes.size).toBe(100);
  });
});

describe("createAdminCode", () => {
  it("returns a 16-character string", () => {
    expect(createAdminCode()).toHaveLength(16);
  });

  it("uses alphanumeric characters (upper and lower)", () => {
    for (let i = 0; i < 20; i++) {
      expect(createAdminCode()).toMatch(/^[0-9a-zA-Z]{16}$/);
    }
  });

  it("generates unique codes", () => {
    const codes = new Set(Array.from({ length: 100 }, createAdminCode));
    expect(codes.size).toBe(100);
  });
});

describe("createAnonVoterKey", () => {
  it("starts with 'anon_'", () => {
    expect(createAnonVoterKey()).toMatch(/^anon_/);
  });

  it("has sufficient length for uniqueness", () => {
    expect(createAnonVoterKey().length).toBeGreaterThan(10);
  });

  it("generates unique keys", () => {
    const keys = new Set(Array.from({ length: 100 }, createAnonVoterKey));
    expect(keys.size).toBe(100);
  });
});
