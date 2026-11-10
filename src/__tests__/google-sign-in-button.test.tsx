import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GOOGLE_G_LIGHT_SVG, GOOGLE_G_LIGHT_SVG_SHA256, googleGMarkup } from "@/lib/google-g";
import { GoogleSignInButton, SIGN_IN_BUTTON_CLASS } from "@/components/google-sign-in-button";
import { SignInPanel } from "@/components/signin-panel";

const noop = () => {};

describe("Google's G", () => {
  it("is Google's asset, byte for byte", () => {
    expect(createHash("sha256").update(GOOGLE_G_LIGHT_SVG).digest("hex")).toBe(GOOGLE_G_LIGHT_SVG_SHA256);
    expect(GOOGLE_G_LIGHT_SVG_SHA256).toBe("6587b180203a99da15c0a041018e15c94ffd9556c4b9855bdc69806081a93791");
  });

  it("shows only the 20x20 G, hidden from screen readers", () => {
    const m = googleGMarkup();
    expect(m.startsWith('<svg width="20" height="20" viewBox="10 10 20 20" focusable="false" aria-hidden="true"')).toBe(true);
    expect(m.slice(m.indexOf(">"))).toBe(GOOGLE_G_LIGHT_SVG.slice(GOOGLE_G_LIGHT_SVG.indexOf(">")));
  });
});

describe("GoogleSignInButton", () => {
  it("uses Google's text and light theme", () => {
    const html = renderToStaticMarkup(createElement(GoogleSignInButton, { onClick: noop }));
    expect(html).toContain("Continue with Google");
    expect(html).toContain('viewBox="10 10 20 20"');
    for (const c of ["bg-white", "border-[#747775]", "text-[#1F1F1F]", "h-10", "rounded-full", "text-[14px]", "leading-5", "font-medium", "px-3"]) {
      expect(SIGN_IN_BUTTON_CLASS.split(" ")).toContain(c);
    }
    expect(html).toContain("mr-[10px]");
  });

  it("takes the other allowed text", () => {
    const html = renderToStaticMarkup(createElement(GoogleSignInButton, { text: "Sign in with Google", onClick: noop }));
    expect(html).toContain("Sign in with Google");
  });
});

describe("GoogleSignInButton compact", () => {
  it("is Google's icon-only button on narrow screens and keeps the text for screen readers", () => {
    const html = renderToStaticMarkup(
      createElement(GoogleSignInButton, { text: "Sign in with Google", compact: true, onClick: noop }),
    );
    expect(html).toContain('max-sm:w-10 max-sm:px-[9px]');
    expect(html).toContain('<span class="max-sm:sr-only">Sign in with Google</span>');
    expect(html).toContain("sm:mr-[10px]");
    expect(html).not.toContain(' mr-[10px]');
  });
});

describe("SignInPanel", () => {
  it("shows the branded Google button and an equally prominent email button", () => {
    const html = renderToStaticMarkup(createElement(SignInPanel, { isSignedIn: false }));
    expect(html).toContain("Continue with Google");
    expect(html).toContain("Email me a sign-in link");
    expect(html).not.toContain("Google sign-in");
    // Both buttons share the same class (React escapes the quotes in it, so count a plain part).
    expect(html.split("inline-flex h-10 shrink-0 items-center").length - 1).toBe(2);
  });
});
