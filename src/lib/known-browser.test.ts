import { describe, it, expect } from "vitest";
import { issueKnownBrowser, knownBrowserCookie, knownBrowserId, knownBrowserSecret } from "./known-browser";
import { CODE_LIMITS, KNOWN_BROWSER_DAYS } from "./sign-in-code";

const SECRET = "test-secret";
const T0 = new Date("2026-11-20T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("known-browser cookie", () => {
  it("is valid for the address it was issued for, for a year, and gives a stable id", () => {
    const value = issueKnownBrowser("prof@uw.test", SECRET, T0);
    expect(value).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(value).not.toContain("prof");
    const id = knownBrowserId(value, "prof@uw.test", SECRET, T0);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(knownBrowserId(value, "prof@uw.test", SECRET, new Date(T0.getTime() + 364 * DAY))).toBe(id);
    expect(knownBrowserId(value, "prof@uw.test", SECRET, new Date(T0.getTime() + KNOWN_BROWSER_DAYS * DAY + 1000))).toBeNull();
  });

  it("is worth nothing for another address, with another secret, or changed", () => {
    const value = issueKnownBrowser("prof@uw.test", SECRET, T0);
    expect(knownBrowserId(value, "student@uw.test", SECRET, T0)).toBeNull();
    expect(knownBrowserId(value, "prof@uw.test", "another-secret", T0)).toBeNull();
    expect(knownBrowserId(value, "prof@uw.test", null, T0)).toBeNull();
    const [v, expiry, mac] = value.split(".");
    expect(knownBrowserId(`${v}.${Number(expiry) + 1}.${mac}`, "prof@uw.test", SECRET, T0)).toBeNull();
    expect(knownBrowserId(`${v}.${expiry}.${mac[0] === "A" ? "Q" : "A"}${mac.slice(1)}`, "prof@uw.test", SECRET, T0)).toBeNull();
    for (const bad of [null, undefined, "", "v1", "v2.1.x", `v1.${expiry}.${mac}.extra`, "x".repeat(4000)]) {
      expect(knownBrowserId(bad, "prof@uw.test", SECRET, T0)).toBeNull();
    }
  });

  it("cannot be made without the secret: a forged expiry or mac fails", () => {
    const forged = `v1.${Math.floor(T0.getTime() / 1000) + 1000}.${"A".repeat(43)}`;
    expect(knownBrowserId(forged, "prof@uw.test", SECRET, T0)).toBeNull();
  });

  it("is a long-lived, host-only, Secure, httpOnly, SameSite=Lax cookie on https", () => {
    expect(knownBrowserCookie(true).serialize("v")).toBe(
      "__Host-upvoteme.known-browser=v; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure",
    );
    expect(knownBrowserCookie(false).serialize("v")).toBe("upvoteme.known-browser=v; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax");
  });

  it("uses NextAuth's secret: NEXTAUTH_SECRET, else AUTH_SECRET, else none", () => {
    expect(knownBrowserSecret({ NEXTAUTH_SECRET: "a", AUTH_SECRET: "b" })).toBe("a");
    expect(knownBrowserSecret({ AUTH_SECRET: "b" })).toBe("b");
    expect(knownBrowserSecret({ NEXTAUTH_SECRET: "" })).toBeNull();
    expect(knownBrowserSecret({})).toBeNull();
  });
});

describe("CODE_LIMITS", () => {
  it("are the agreed numbers", () => {
    expect(CODE_LIMITS).toEqual({
      address: { hour: 6, day: 12 },
      clientAndAddress: { hour: 3, day: 4 },
      client: { hour: 300, day: 1000 },
      knownBrowser: { hour: 3, day: 6 },
    });
  });

  it("never let one client use up an address's allowance alone", () => {
    expect(CODE_LIMITS.clientAndAddress.hour).toBeLessThan(CODE_LIMITS.address.hour);
    expect(CODE_LIMITS.clientAndAddress.day).toBeLessThan(CODE_LIMITS.address.day);
  });
});
