import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HwEventsScript } from "@/components/hw-events-script";
import NotFound from "@/app/not-found";
import { ANALYTICS_APP, HW_EVENTS_MASK, HW_EVENTS_SHA256, HW_EVENTS_SRC, track } from "@/lib/analytics";
import { isCanonicalPath } from "@/lib/canonical-path";
import { safeCallbackUrl } from "@/lib/callback-url";

const root = resolve(__dirname, "../..");
const SCRIPT = readFileSync(join(root, "public/hw-events.js"), "utf8");
const LOADER = readFileSync(join(root, "public/hw-loader.js"), "utf8");
const TAG = '<script defer="" src="/hw-loader.js" data-app="upvoteme" data-mask="/t/ /a/ /T/ /A/"></script>';
const ORIGIN = "https://upvoteme.hintwise.org";
const CODE = "QqWwEeRrTtYyUuIi"; // all letters: the script's id rule alone would send it

/** Addresses, as typed, whose path is canonical, and what the page sends for each. */
const CANONICAL: [string, string][] = [
  ["/", "/"],
  ["/signin", "/signin"],
  ["/signin?callbackUrl=%2Ft%2Fabcd12ef", "/signin"],
  ["/superadmin", "/superadmin"],
  ["/t/abcd12ef", "/t/:id"],
  ["/t/qwertyui", "/t/:id"],
  [`/a/${CODE}`, "/a/:id"],
  [`/a/${CODE}?x#y`, "/a/:id"],
  [`/a/./${CODE}`, "/a/:id"], // the browser removes the dot segment itself
];

/** Addresses, as typed, whose path is not canonical. */
const NOT_CANONICAL = [
  `//a/${CODE}`,
  `///a/${CODE}`,
  `/a//${CODE}`,
  `/a///${CODE}`,
  `/%61//${CODE}`,
  `/%61/${CODE}`,
  `/%74/${CODE}`,
  `/%54/${CODE}`,
  `/%41/${CODE}`,
  `/a%2F${CODE}`,
  `/a%2f${CODE}`,
  `/%61%2F${CODE}`,
  `/%2561/${CODE}`,
  `/a./${CODE}`,
  `/a../${CODE}`,
  `/a%20/${CODE}`,
  `//t/${CODE}`,
  `/t//${CODE}`,
  `/t/${CODE}.`,
  `/t/${CODE}/`,
  `/a/${CODE}/`,
  `/a//${CODE}?x#y`,
];

/** location.pathname for an address typed on this site. */
const pathnameOf = (path: string) => new URL(ORIGIN + path).pathname;

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

type FakeScript = { src: string; attrs: Record<string, string>; setAttribute(k: string, v: string): void };

/** Runs public/hw-loader.js on a page at `pathname` and returns the scripts it inserted. */
function loaderInserts(pathname: string, { notFound = false, attrs = { "data-app": ANALYTICS_APP, "data-mask": HW_EVENTS_MASK } } = {}) {
  const inserted: FakeScript[] = [];
  const g: Record<string, unknown> = {
    document: {
      currentScript: { getAttribute: (k: string) => (attrs as Record<string, string>)[k] ?? null },
      querySelector: (sel: string) => (sel === "[data-hw-not-found]" && notFound ? {} : null),
      createElement: (tag: string) => {
        expect(tag).toBe("script");
        const el: FakeScript = { src: "", attrs: {}, setAttribute: (k, v) => void (el.attrs[k] = v) };
        return el;
      },
      head: { appendChild: (el: FakeScript) => inserted.push(el) },
    },
    location: { pathname },
  };
  g.window = g;
  runInNewContext(LOADER, g);
  return inserted;
}

/** What a page opened at `path` (exactly as typed, query and hash included) sends: loader, then the script it inserts. */
async function pageSends(path: string, opts: { notFound?: boolean } = {}) {
  const { pathname } = new URL(ORIGIN + path); // as the browser shows it in location.pathname
  const out = [];
  for (const el of loaderInserts(pathname, opts)) {
    expect(el.src).toBe(HW_EVENTS_SRC);
    out.push(...(await beaconsFor(pathname, el.attrs)));
  }
  return out;
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
    expect(HW_EVENTS_MASK).toBe("/t/ /a/ /T/ /A/");
  });

  it("sends topic and admin pages as /t/:id and /a/:id, whatever the code looks like", async () => {
    const attrs = { "data-app": ANALYTICS_APP, "data-mask": HW_EVENTS_MASK };
    for (const [path, want] of [
      ["/t/abcdefgh", "/t/:id"],
      ["/t/abcd12ef", "/t/:id"],
      ["/a/RHxtrCXLGyyrOooh", "/a/:id"],
      ["/a/dVKAtQG1KYYfWxNf", "/a/:id"],
      // A second guard: no page answers upper-case prefixes.
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

  it("would send these codes as they are without data-mask", async () => {
    const bodies = await beaconsFor("/a/RHxtrCXLGyyrOooh", { "data-app": ANALYTICS_APP });
    expect(bodies[0].e[0].p).toBe("/a/RHxtrCXLGyyrOooh");
  });
});

describe("hw-loader.js", () => {
  it("loads the script, with the tag's data-app and data-mask, on canonical paths, and codes go out as :id", async () => {
    for (const [path, want] of CANONICAL) {
      expect(await pageSends(path), path).toEqual([{ a: "upvoteme", e: [{ n: "pageview", p: want }] }]);
    }
    const [el] = loaderInserts("/t/abcd12ef");
    expect(el).toEqual(expect.objectContaining({ src: "/hw-events.js", attrs: { "data-app": "upvoteme", "data-mask": "/t/ /a/ /T/ /A/" } }));
  });

  it("loads nothing on a path that is not canonical", async () => {
    for (const path of NOT_CANONICAL) {
      expect(loaderInserts(pathnameOf(path)), path).toEqual([]);
      expect(await pageSends(path), path).toEqual([]);
    }
  });

  it("loads nothing on the not-found page, whatever the path", async () => {
    for (const path of ["/", "/t/abcd12ef", `/a/${CODE}`, `/zz/${CODE}`, `/A/${CODE}`, `/T/${CODE}`]) {
      expect(await pageSends(path, { notFound: true }), path).toEqual([]);
    }
  });

  it("applies the same rule as isCanonicalPath, which the app uses for in-app targets", () => {
    const table = [
      ...CANONICAL.map(([p]) => pathnameOf(p)),
      ...NOT_CANONICAL.map(pathnameOf),
      ...["", "a", "/a", "/a/b", "/a/b/", "//", "/.", "/..", "/a/.b", "/a/b.c", "/a/;x", "/a%3Bx/b", "/~a/_b-c"],
    ];
    for (const pathname of table) {
      expect(loaderInserts(pathname).length === 1, pathname).toBe(isCanonicalPath(pathname));
    }
    expect(table.filter((p) => isCanonicalPath(p)).length).toBeGreaterThan(5);
    expect(table.filter((p) => !isCanonicalPath(p)).length).toBeGreaterThan(20);
  });

  it("safeCallbackUrl, the only in-app target taken from input, always gives a path the loader accepts", async () => {
    for (const path of [...NOT_CANONICAL, ...CANONICAL.map(([p]) => p)]) {
      const target = safeCallbackUrl(path);
      expect(loaderInserts(pathnameOf(target)), `${path} -> ${target}`).toHaveLength(1);
      for (const body of await pageSends(target)) {
        for (const e of body.e) expect(e.p, `${path} -> ${target}`).not.toContain(CODE);
      }
    }
    expect(safeCallbackUrl(`/a//${CODE}`)).toBe(`/a/${CODE}`);
  });

  it("does nothing without document.currentScript", () => {
    const inserted: unknown[] = [];
    const doc = { currentScript: null, querySelector: () => null, head: { appendChild: (e: unknown) => inserted.push(e) } };
    runInNewContext(LOADER, { document: doc, location: { pathname: "/" } });
    expect(inserted).toEqual([]);
  });
});

describe("not-found page", () => {
  it("carries the marker that keeps the loader from loading the script", () => {
    const html = renderToStaticMarkup(createElement(NotFound));
    expect(html).toMatch(/^<main data-hw-not-found=""/);
  });
});

describe("HwEventsScript", () => {
  it("renders the loader tag with data-app and data-mask", () => {
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

    const named = /hw-(events|loader)\.js|HW_(EVENTS|LOADER)_SRC|<HwEventsScript/;
    const users = sourceFiles(join(root, "src")).filter((f) => named.test(readFileSync(f, "utf8")));
    expect(users.map((f) => f.slice(root.length + 1)).sort()).toEqual([
      "src/app/layout.tsx",
      "src/app/not-found.tsx", // a comment
      "src/components/hw-events-script.tsx",
      "src/lib/analytics.ts",
      "src/lib/canonical-path.ts", // a comment
    ]);
    // Only the component renders a <script>, and only it uses the loader's address.
    const scripts = sourceFiles(join(root, "src")).filter((f) => /<script|HW_LOADER_SRC\b/.test(readFileSync(f, "utf8")));
    expect(scripts.map((f) => f.slice(root.length + 1)).sort()).toEqual(["src/components/hw-events-script.tsx", "src/lib/analytics.ts"]);
  });

  it("in public/, only hw-loader.js loads /hw-events.js", () => {
    const pub = join(root, "public");
    const files = readdirSync(pub).filter((name) => statSync(join(pub, name)).isFile() && name !== "hw-events.js");
    const loaders = files.filter((name) => /hw-events\.js/.test(readFileSync(join(pub, name), "utf8")));
    expect(loaders).toEqual(["hw-loader.js"]);
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
