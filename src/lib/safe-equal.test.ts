import { describe, it, expect } from "vitest";
import { safeEqual } from "./safe-equal";

describe("safeEqual", () => {
  it("returns true for identical strings", () => {
    expect(safeEqual("s3cret-token-value", "s3cret-token-value")).toBe(true);
  });

  it("returns false for different same-length strings", () => {
    // Same length so the comparison reaches timingSafeEqual rather than the
    // length short-circuit; the old `===`/`!==` code would also reject this,
    // but this proves the constant-time path returns false correctly.
    expect(safeEqual("s3cret-token-valuE", "s3cret-token-value")).toBe(false);
  });

  it("returns false for different-length strings", () => {
    expect(safeEqual("short", "a-much-longer-secret")).toBe(false);
  });

  it("returns false (never throws) for nullish input", () => {
    expect(safeEqual(null, "secret")).toBe(false);
    expect(safeEqual("secret", undefined)).toBe(false);
    expect(safeEqual(null, null)).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });

  it("handles multi-byte utf8 without throwing", () => {
    expect(safeEqual("naïve-café-🔑", "naïve-café-🔑")).toBe(true);
    expect(safeEqual("naïve-café-🔑", "naive-cafe-xx")).toBe(false);
  });
});
