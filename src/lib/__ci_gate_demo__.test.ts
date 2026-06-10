import { describe, it, expect } from "vitest";
// TEMPORARY scratch test to demonstrate CI blocks a breaking PR with a red X.
// This branch and PR will be closed/deleted, not merged.
describe("ci gate demo (intentional failure)", () => {
  it("breaks on purpose so CI must fail", () => {
    expect(2 + 2).toBe(5);
  });
});
