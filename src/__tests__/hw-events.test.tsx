import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HwEventsScript } from "@/components/hw-events-script";
import { ANALYTICS_APP, HW_EVENTS_MASK, HW_EVENTS_SHA256, track } from "@/lib/analytics";

const root = resolve(__dirname, "../..");
const SCRIPT = readFileSync(join(root, "public/hw-events.js"), "utf8");
const TAG =
  '<script defer="" src="/hw-events.js" data-app="upvoteme" data-mask="/t/ /a/ /T/ /A/ /%74/ /%61/ /%54/ /%41/"></script>';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

/** Runs the copied script on a page at `pathname` and returns what it would send on pagehide. */
async function beaconsFor(pathname: string, attrs: Record<string, string>) {
  const listeners: Record<string, (() => void)[]> = {};
  const sent: Blob[] = [];
  const g: Record<string, unknown> = {
    document: {
      currentScript: { getAttribute: (k: string) => attrs[k] ?? null },
      visibilityState: "visible",
      referrer: "",
      addEventListener: () => {},
    },
    location: { pathname, hostname: "upvoteme.hintwise.org", href: `https://upvoteme.hintwise.org${pathname}` },
    navigator: { sendBeacon: (_url: string, body: Blob) => sent.push(body) },
    history: { pushState() {}, replaceState() {} },
    addEventListener: (type: string, fn: () => void) => (listeners[type] ??= []).push(fn),
    Blob,
    URL,
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  g.window = g;
  runInNewContext(SCRIPT, g);
  listeners.pagehide?.forEach((fn) => fn());
  return Promise.all(sent.map(async (b) => JSON.parse(await b.text())));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hw-events.js", () => {
  it("is the platform's script, byte for byte", () => {
    expect(createHash("sha256").update(SCRIPT).digest("hex")).toBe(HW_EVENTS_SHA256);
    expect(HW_EVENTS_SHA256).toBe("d2833162b9f18f9f2fdb36dbd62440c13ee26c6600200d8e55ad32b907f00633");
  });

  it("uses the app's hintwise.org subdomain as its slug and masks topic and admin codes", () => {
    expect(ANALYTICS_APP).toBe("upvoteme");
    expect(HW_EVENTS_MASK).toBe("/t/ /a/ /T/ /A/ /%74/ /%61/ /%54/ /%41/");
  });

  it("sends topic and admin pages as /t/:id and /a/:id, whatever the code looks like", async () => {
    const attrs = { "data-app": ANALYTICS_APP, "data-mask": HW_EVENTS_MASK };
    for (const [path, want] of [
      ["/t/abcdefgh", "/t/:id"],
      ["/t/abcd12ef", "/t/:id"],
      ["/a/RHxtrCXLGyyrOooh", "/a/:id"],
      ["/a/dVKAtQG1KYYfWxNf", "/a/:id"],
      // Mistyped upper-case prefixes reach the not-found page, which carries the tag.
      ["/T/abcdefgh", "/T/:id"],
      ["/A/RHxtrCXLGyyrOooh", "/A/:id"],
      ["/t/x", "/t/:id"],
      ["/a/x", "/a/:id"],
      ["/signin", "/signin"],
      ["/", "/"],
    ]) {
      const bodies = await beaconsFor(path, attrs);
      expect(bodies).toEqual([{ a: "upvoteme", e: [{ n: "pageview", p: want }] }]);
    }
  });

  it("masks hand-crafted links whose first segment is percent-encoded (they reach the not-found page)", async () => {
    const attrs = { "data-app": ANALYTICS_APP, "data-mask": HW_EVENTS_MASK };
    for (const [href, want] of [
      ["/%74/x", "/%74/:id"],
      ["/%61/x", "/%61/:id"],
      ["/%54/x", "/%54/:id"],
      ["/%41/x", "/%41/:id"],
      ["/%74/abcdefgh", "/%74/:id"],
      ["/%61/RHxtrCXLGyyrOooh?x=1#y", "/%61/:id"],
      ["/%54/abcdefgh", "/%54/:id"],
      ["/%41/dVKAtQG1KYYfWxNf", "/%41/:id"],
    ]) {
      // A browser keeps the encoded prefix in location.pathname (WHATWG URL).
      const { pathname } = new URL(href, "https://upvoteme.hintwise.org");
      expect(pathname.startsWith(href.slice(0, 5))).toBe(true);
      const bodies = await beaconsFor(pathname, attrs);
      expect(bodies).toEqual([{ a: "upvoteme", e: [{ n: "pageview", p: want }] }]);
    }
  });

  it("lists the one percent-encoded form of every masked prefix", () => {
    const masks = HW_EVENTS_MASK.split(" ");
    for (const letter of ["t", "a", "T", "A"]) {
      const hex = letter.charCodeAt(0).toString(16);
      expect(hex).toMatch(/^\d+$/); // no a-f digits, so no upper/lower-case hex variants
      expect(masks).toContain(`/${letter}/`);
      expect(masks).toContain(`/%${hex}/`);
      expect(decodeURIComponent(`%${hex}`)).toBe(letter);
    }
    expect(masks).toHaveLength(8);
  });

  it("would send an encoded-prefix code as it is with only the plain prefixes", async () => {
    const bodies = await beaconsFor("/%61/RHxtrCXLGyyrOooh", { "data-app": ANALYTICS_APP, "data-mask": "/t/ /a/ /T/ /A/" });
    expect(bodies[0].e[0].p).toBe("/%61/RHxtrCXLGyyrOooh");
  });

  it("would send these codes as they are without data-mask", async () => {
    const bodies = await beaconsFor("/a/RHxtrCXLGyyrOooh", { "data-app": ANALYTICS_APP });
    expect(bodies[0].e[0].p).toBe("/a/RHxtrCXLGyyrOooh");
  });
});

describe("HwEventsScript", () => {
  it("renders the tag with data-app and data-mask", () => {
    expect(renderToStaticMarkup(createElement(HwEventsScript))).toBe(TAG);
  });

  it("sits once in the root layout's <head>, on every route, and nothing else loads the script", () => {
    const layout = readFileSync(join(root, "src/app/layout.tsx"), "utf8");
    expect(layout.split("<HwEventsScript />").length - 1).toBe(1);
    const head = layout.slice(layout.indexOf("<head>"), layout.indexOf("</head>"));
    expect(head.trim()).toBe("<head>\n        <HwEventsScript />");

    const component = readFileSync(join(root, "src/components/hw-events-script.tsx"), "utf8");
    expect(component).not.toMatch(/usePathname|useState|useEffect/);

    // /t/[code] and /a/[adminCode] have no layout of their own that could drop the tag.
    const adminLayout = readFileSync(join(root, "src/app/a/[adminCode]/layout.tsx"), "utf8");
    expect(adminLayout).toContain("<>{children}</>");

    const users = sourceFiles(join(root, "src")).filter((f) => /hw-events\.js|<HwEventsScript/.test(readFileSync(f, "utf8")));
    expect(users.map((f) => f.slice(root.length + 1)).sort()).toEqual([
      "src/app/layout.tsx",
      "src/components/hw-events-script.tsx",
      "src/lib/analytics.ts",
    ]);
  });
});

describe("track", () => {
  it("is a no-op without the script", () => {
    expect(() => track("topic_created", { auth_voting: false })).not.toThrow();
    vi.stubGlobal("window", {});
    expect(() => track("topic_created", { auth_voting: false })).not.toThrow();
  });

  it("never throws, even when the script's track throws or is missing", () => {
    vi.stubGlobal("window", { hintwise: { track: () => { throw new Error("boom"); } } });
    expect(() => track("sign_in_started", { method: "google" })).not.toThrow();
    vi.stubGlobal("window", { hintwise: {} });
    expect(() => track("sign_in_started", { method: "email" })).not.toThrow();
  });

  it("passes the name and props to window.hintwise.track", () => {
    const spy = vi.fn();
    vi.stubGlobal("window", { hintwise: { track: spy } });
    track("sign_in_started", { method: "email" });
    expect(spy).toHaveBeenCalledWith("sign_in_started", { method: "email" });
  });
});
