import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Session } from "next-auth";

const state = vi.hoisted(() => ({ session: null as Session | null, pathname: "/" as string | null, search: "" }));

vi.mock("@/auth", () => ({ auth: async () => state.session }));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.search),
}));

import SignInPage from "@/app/signin/page";
import { NavBarClient, magicLinkHref } from "@/components/nav-bar-client";
import { SignInPanel } from "@/components/signin-panel";
import { signInErrorMessage } from "@/lib/sign-in-errors";

async function renderPage(query: Record<string, string | string[] | undefined> = {}) {
  return renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve(query) }));
}

/** The href of the first link whose markup contains `text`. */
function hrefOf(html: string, text: string): string | undefined {
  const link = [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g)].find((m) => m[2].includes(text));
  return link?.[1].replaceAll("&amp;", "&");
}

beforeEach(() => {
  state.session = null;
  state.pathname = "/";
  state.search = "";
});

describe("/signin, signed out", () => {
  it("shows the heading, Google, an 'or' divider, then the email form, in that order", async () => {
    const html = await renderPage();
    const order = ["<h1", ">Sign in</h1>", "Continue with Google", ">or<", 'type="email"', "Email me a sign-in link"].map((s) =>
      html.indexOf(s),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain('role="alert"');
  });

  it("makes the Google button and the email button the same width and shape", async () => {
    const html = await renderPage();
    const buttons = [...html.matchAll(/<button [^>]*class="([^"]*)"/g)].map((m) => m[1]);
    expect(buttons).toHaveLength(2);
    for (const cls of buttons) {
      expect(cls).toContain("inline-flex h-10 shrink-0 items-center");
      expect(cls.split(" ")).toContain("w-full");
    }
  });

  it.each([
    ["Verification", "That sign-in link has expired or has already been used."],
    ["EmailSignin", "We could not send a sign-in link to that address."],
    ["OAuthAccountNotLinked", "That email address already signs in another way."],
    ["OAuthCallback", "Google sign-in did not finish."],
    ["Default", "Something went wrong while signing you in."],
  ])("explains ?error=%s in plain words", async (code, words) => {
    const html = await renderPage({ error: code });
    expect(html).toMatch(/<p role="alert"[^>]*>/);
    expect(html).toContain(words);
    expect(html).not.toContain(`>${code}<`);
  });

  it("never shows the raw text of an unknown code", async () => {
    const html = await renderPage({ error: "Call 555-0100 to restore your account" });
    expect(html).toContain("Something went wrong while signing you in.");
    expect(html).not.toContain("555-0100");
  });
});

describe("/signin, signed in", () => {
  beforeEach(() => {
    state.session = { user: { id: "u1", name: "Alice", email: "alice@example.com" }, expires: "2099-01-01T00:00:00Z" };
  });

  it("says who is signed in and offers a way back and a sign-out, not the form", async () => {
    const html = await renderPage({ callbackUrl: "/t/abc" });
    expect(html).toContain("You are signed in");
    expect(html).toContain(">Alice</strong>");
    expect(html).toContain("alice@example.com");
    expect(hrefOf(html, "Continue")).toBe("/t/abc");
    expect(html).toContain(">Sign out</button>");
    expect(html).not.toContain('type="email"');
    expect(html).not.toContain("Continue with Google");
  });

  it.each(["//evil.example", "https://evil.example/", "/\\evil.example", "/..//evil.example", "/x/..//evil.example"])(
    "sends an unsafe callbackUrl (%s) to the home page instead",
    async (callbackUrl) => {
      const html = await renderPage({ callbackUrl });
      expect(hrefOf(html, "Go to the home page")).toBe("/");
      expect(html).not.toContain("evil.example");
    },
  );

  it("uses the first callbackUrl when there are several", async () => {
    const html = await renderPage({ callbackUrl: ["/t/one", "//evil.example"] });
    expect(hrefOf(html, "Continue")).toBe("/t/one");
  });
});

describe("top bar, signed out", () => {
  function topBar() {
    return renderToStaticMarkup(createElement(NavBarClient, { user: null }));
  }

  it("links Magic link to the sign-in page, returning to the current page", () => {
    state.pathname = "/t/abc123";
    const html = topBar();
    expect(hrefOf(html, "Magic link")).toBe("/signin?callbackUrl=/t/abc123");
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*Magic link/);
  });

  it("keeps the query, so a thread view comes back to itself", () => {
    state.pathname = "/t/abc123";
    state.search = "root=c1";
    expect(hrefOf(topBar(), "Magic link")).toBe("/signin?callbackUrl=/t/abc123%3Froot%3Dc1");
    expect(magicLinkHref("/t/abc123", "root=c1")).toBe("/signin?callbackUrl=/t/abc123%3Froot%3Dc1");
    expect(magicLinkHref("/..//evil.example", "")).toBe("/signin?callbackUrl=/");
  });

  it("keeps the compact look: envelope icon, label hidden on phones, round on small screens", () => {
    state.pathname = "/";
    const html = topBar();
    const link = html.match(/<a [^>]*>.*?Magic link.*?<\/a>/)![0];
    expect(link).toContain("max-sm:w-10 max-sm:px-[9px]");
    expect(link).toContain("<svg");
    expect(link).toContain('<span class="max-sm:sr-only">Magic link</span>');
    expect(html).toContain("Sign in with Google");
  });

  it("points at the email field when already on the sign-in page", () => {
    expect(magicLinkHref("/signin")).toBe("#signin-email");
    expect(magicLinkHref(null)).toBe("/signin?callbackUrl=/");
    expect(magicLinkHref("/")).toBe("/signin?callbackUrl=/");
  });
});

describe("topic page sign-in box", () => {
  it("keeps Google and links the email option to the sign-in page, returning to the topic", () => {
    const html = renderToStaticMarkup(createElement(SignInPanel, { isSignedIn: false, callbackUrl: "/t/abc123" }));
    expect(html).toContain("Continue with Google");
    expect(hrefOf(html, "Email me a sign-in link")).toBe("/signin?callbackUrl=/t/abc123");
  });
});

describe("sign-in error words", () => {
  it("has none for no code, and the Default words for prototype keys", () => {
    expect(signInErrorMessage(undefined)).toBeNull();
    expect(signInErrorMessage("")).toBeNull();
    for (const code of ["constructor", "__proto__", "toString"]) {
      expect(signInErrorMessage(code)).toBe(signInErrorMessage("Default"));
    }
  });
});

describe("no browser popup", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  }

  const src = resolve(__dirname, "..");

  it("no app code calls window.prompt", () => {
    const files = sourceFiles(src);
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter((f) => /\b(?:window\.)?prompt\s*\(/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the sign-in code calls no alert or confirm either", () => {
    const files = [
      "app/signin/page.tsx",
      "components/email-sign-in-form.tsx",
      "components/signin-panel.tsx",
      "components/nav-bar-client.tsx",
      "components/google-sign-in-button.tsx",
    ];
    for (const f of files) {
      expect(readFileSync(join(src, f), "utf8")).not.toMatch(/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/);
    }
  });
});
