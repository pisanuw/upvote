import { describe, it, expect } from "vitest";
import { currentPageCallbackUrl, safeCallbackUrl, signInHref } from "@/lib/callback-url";

describe("safeCallbackUrl", () => {
  it.each(["/", "/t/abc123", "/t/abc123?root=c1", "/a/xyz#comments", "/t/%2F%2Fexample.com"])(
    "keeps the same-site path %s",
    (path) => {
      expect(safeCallbackUrl(path)).toBe(path);
    },
  );

  it.each([
    ["another host, scheme-relative", "//evil.example/t/abc"],
    ["three slashes", "///evil.example"],
    ["an absolute URL", "https://evil.example/t/abc"],
    ["an absolute URL to this site", "https://upvoteme.hintwise.org/t/abc"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:text/html,hi"],
    ["a backslash after the slash", "/\\evil.example"],
    ["a backslash later on", "/t/abc\\..\\x"],
    ["a tab browsers would drop", "/\t/evil.example"],
    ["a newline browsers would drop", "/\n/evil.example"],
    ["a space", "/t/a b"],
    ["a relative path", "t/abc"],
    ["a bare host", "evil.example"],
    ["an empty string", ""],
    ["a very long path", `/${"a".repeat(2048)}`],
    ["the sign-in page itself", "/signin?callbackUrl=/t/abc"],
    ["the sign-in page with a trailing slash", "/signin/"],
    ["the sign-in page through dot segments", "/x/../signin"],
    ["dot-dot then //", "/..//evil.example"],
    ["dot then //", "/.//evil.example"],
    ["a segment, dot-dot, then //", "/x/..//evil.example"],
    ["encoded dot-dot then //", "/%2e%2e//evil.example"],
    ["two encoded dot-dots then //", "/x/%2E%2E/%2e%2e//evil.example/path?q=1"],
  ])("turns %s into /", (_label, value) => {
    expect(safeCallbackUrl(value)).toBe("/");
  });

  it("returns the parsed path, so what was checked is what is used", () => {
    expect(safeCallbackUrl("/x/../t/abc")).toBe("/t/abc");
    expect(safeCallbackUrl("/./t/abc?root=c1#c2")).toBe("/t/abc?root=c1#c2");
    expect(safeCallbackUrl('/t/abc?q="x"')).toBe("/t/abc?q=%22x%22");
  });

  it.each([undefined, null, 42, ["/t/abc"], { href: "/t/abc" }])("turns a non-string (%j) into /", (value) => {
    expect(safeCallbackUrl(value)).toBe("/");
  });
});

describe("currentPageCallbackUrl", () => {
  it("returns to the current page with its query", () => {
    expect(currentPageCallbackUrl("/t/x", "root=c1")).toBe("/t/x?root=c1");
    expect(currentPageCallbackUrl("/t/x", "?root=c1")).toBe("/t/x?root=c1");
    expect(currentPageCallbackUrl("/t/x", "")).toBe("/t/x");
    expect(currentPageCallbackUrl(null, "")).toBe("/");
  });

  it("on the sign-in page, returns to that page's own (checked) callbackUrl", () => {
    expect(currentPageCallbackUrl("/signin", "callbackUrl=%2Ft%2Fx%3Froot%3Dc1")).toBe("/t/x?root=c1");
    expect(currentPageCallbackUrl("/signin", "callbackUrl=//evil.example")).toBe("/");
    expect(currentPageCallbackUrl("/signin", "error=Verification")).toBe("/");
  });

  it("runs the result through safeCallbackUrl", () => {
    expect(currentPageCallbackUrl("/..//evil.example", "")).toBe("/");
    expect(currentPageCallbackUrl("//evil.example", "a=1")).toBe("/");
  });
});

describe("signInHref", () => {
  it("points at the sign-in page with a readable callbackUrl", () => {
    expect(signInHref("/t/abc123")).toBe("/signin?callbackUrl=/t/abc123");
    expect(signInHref("/")).toBe("/signin?callbackUrl=/");
  });

  it("encodes a query in the callbackUrl so it stays one parameter", () => {
    const href = signInHref("/t/abc?root=c1&x=1");
    expect(href).toBe("/signin?callbackUrl=/t/abc%3Froot%3Dc1%26x%3D1");
    expect(new URL(href, "https://app.test").searchParams.get("callbackUrl")).toBe("/t/abc?root=c1&x=1");
  });

  it("never carries an unsafe target", () => {
    expect(signInHref("//evil.example")).toBe("/signin?callbackUrl=/");
    expect(signInHref("https://evil.example")).toBe("/signin?callbackUrl=/");
  });
});
