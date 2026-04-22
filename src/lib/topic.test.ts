import { describe, it, expect, vi } from "vitest";

// topic.ts imports prisma at module level; mock it so DATABASE_URL isn't needed
vi.mock("@/lib/prisma", () => ({
  prisma: { topic: { delete: vi.fn() } },
}));

import { isExpiredByActivity } from "./topic";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("isExpiredByActivity", () => {
  it("returns false for activity within 30 days", () => {
    const recentDate = new Date(Date.now() - 5 * DAY_MS);
    expect(isExpiredByActivity(recentDate)).toBe(false);
  });

  it("returns false for activity exactly at the boundary (29 days ago)", () => {
    const borderDate = new Date(Date.now() - 29 * DAY_MS);
    expect(isExpiredByActivity(borderDate)).toBe(false);
  });

  it("returns true for activity older than 30 days", () => {
    const oldDate = new Date(Date.now() - 31 * DAY_MS);
    expect(isExpiredByActivity(oldDate)).toBe(true);
  });

  it("returns true for very old activity", () => {
    const ancientDate = new Date(0);
    expect(isExpiredByActivity(ancientDate)).toBe(true);
  });

  it("returns false for activity just now", () => {
    expect(isExpiredByActivity(new Date())).toBe(false);
  });
});
