import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rateLimit, __testing } from "./rate-limit";

beforeEach(() => {
  __testing.store.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-10T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rateLimit", () => {
  it("allows up to the limit, then blocks within the window", () => {
    const opts = { limit: 3, windowMs: 60_000 };
    expect(rateLimit("ip:1", opts).allowed).toBe(true);
    expect(rateLimit("ip:1", opts).allowed).toBe(true);
    expect(rateLimit("ip:1", opts).allowed).toBe(true);
    expect(rateLimit("ip:1", opts).allowed).toBe(false);
  });

  it("resets after the window elapses", () => {
    const opts = { limit: 1, windowMs: 1_000 };
    expect(rateLimit("ip:2", opts).allowed).toBe(true);
    expect(rateLimit("ip:2", opts).allowed).toBe(false);
    vi.advanceTimersByTime(1_001);
    expect(rateLimit("ip:2", opts).allowed).toBe(true);
  });

  it("evicts expired entries so the store does not grow unbounded", () => {
    // Seed an entry that will expire, plus a fresh one.
    rateLimit("stale", { limit: 5, windowMs: 1_000 });
    expect(__testing.store.has("stale")).toBe(true);

    // Advance past the stale entry's window, then touch a different key.
    vi.advanceTimersByTime(2_000);
    rateLimit("fresh", { limit: 5, windowMs: 60_000 });

    // The expired "stale" key must have been evicted by the eviction sweep.
    expect(__testing.store.has("stale")).toBe(false);
    expect(__testing.store.has("fresh")).toBe(true);
  });
});
