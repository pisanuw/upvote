import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { HwEventsScript } from "@/components/hw-events-script";
import { ANALYTICS_APP, HW_EVENTS_SHA256, analyticsAllowed, loadHwEvents, track } from "@/lib/analytics";

const root = resolve(__dirname, "../..");
const TAG = '<script defer="" src="/hw-events.js" data-app="upvoteme"></script>';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

afterEach(() => {
  pathname = "/";
  vi.unstubAllGlobals();
});

describe("hw-events.js", () => {
  it("is the platform's script, byte for byte", () => {
    const js = readFileSync(join(root, "public/hw-events.js"));
    expect(createHash("sha256").update(js).digest("hex")).toBe(HW_EVENTS_SHA256);
    expect(HW_EVENTS_SHA256).toBe("fe0b6e92ddd6093e9ba7fa2b9fff32cd68bb5a42e191e9770fda93e5a1ba6227");
  });

  it("uses the app's hintwise.org subdomain as its slug", () => {
    expect(ANALYTICS_APP).toBe("upvoteme");
  });
});

describe("HwEventsScript", () => {
  it("renders the tag once on ordinary pages", () => {
    for (const p of ["/", "/signin", "/superadmin"]) {
      pathname = p;
      const html = renderToStaticMarkup(createElement(HwEventsScript));
      expect(html).toBe(TAG);
    }
  });

  it("renders nothing on topic and admin pages, whose path holds the access code", () => {
    for (const p of ["/t/abcdefgh", "/t/abcd12ef", "/a/RHxtrCXLGyyrOooh", "/t", "/a/"]) {
      pathname = p;
      expect(renderToStaticMarkup(createElement(HwEventsScript))).toBe("");
    }
  });

  it("sits once in the root layout's <head>, and nothing else loads the script", () => {
    const layout = readFileSync(join(root, "src/app/layout.tsx"), "utf8");
    expect(layout.split("<HwEventsScript />").length - 1).toBe(1);
    const head = layout.slice(layout.indexOf("<head>"), layout.indexOf("</head>"));
    expect(head).toContain("<HwEventsScript />");

    const users = sourceFiles(join(root, "src")).filter((f) => /hw-events\.js|<HwEventsScript/.test(readFileSync(f, "utf8")));
    expect(users.map((f) => f.slice(root.length + 1)).sort()).toEqual([
      "src/app/layout.tsx",
      "src/components/hw-events-script.tsx",
      "src/lib/analytics.ts",
    ]);
  });
});

describe("analyticsAllowed", () => {
  it("allows every page but /t/... and /a/...", () => {
    expect(analyticsAllowed("/")).toBe(true);
    expect(analyticsAllowed("/signin")).toBe(true);
    expect(analyticsAllowed("/topics")).toBe(true);
    expect(analyticsAllowed("/t/abc")).toBe(false);
    expect(analyticsAllowed("/a/abc")).toBe(false);
    expect(analyticsAllowed(null)).toBe(false);
  });
});

describe("loadHwEvents", () => {
  function fakeDocument(existing: boolean) {
    const appended: { src: string; attrs: Record<string, string> }[] = [];
    const doc = {
      querySelector: (sel: string) => (existing && sel === 'script[src="/hw-events.js"]' ? {} : null),
      createElement: () => {
        const el = { src: "", attrs: {} as Record<string, string>, setAttribute: (k: string, v: string) => (el.attrs[k] = v) };
        return el;
      },
      head: { appendChild: (el: { src: string; attrs: Record<string, string> }) => appended.push(el) },
    };
    return { doc: doc as unknown as Document, appended };
  }

  it("adds the script with data-app when the page has none", () => {
    const { doc, appended } = fakeDocument(false);
    loadHwEvents(doc);
    expect(appended).toHaveLength(1);
    expect(appended[0].src).toBe("/hw-events.js");
    expect(appended[0].attrs).toEqual({ "data-app": "upvoteme" });
  });

  it("does nothing when the script is already on the page", () => {
    const { doc, appended } = fakeDocument(true);
    loadHwEvents(doc);
    expect(appended).toHaveLength(0);
  });
});

describe("track", () => {
  it("is a no-op without the script", () => {
    expect(() => track("topic_created", { auth_voting: false })).not.toThrow();
    vi.stubGlobal("window", {});
    expect(() => track("topic_created", { auth_voting: false })).not.toThrow();
  });

  it("passes the name and props to window.hintwise.track", () => {
    const spy = vi.fn();
    vi.stubGlobal("window", { hintwise: { track: spy } });
    track("sign_in_started", { method: "email" });
    expect(spy).toHaveBeenCalledWith("sign_in_started", { method: "email" });
  });
});
